import * as piperTts from "https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/+esm";

(() => {
  const config = window.MABEL_CONFIG;
  const permissionScreen = document.querySelector("#permission-screen");
  const conversationScreen = document.querySelector("#conversation-screen");
  const allowButton = document.querySelector("#allow-microphone");
  const permissionError = document.querySelector("#permission-error");
  const talkButton = document.querySelector("#talk-button");
  const talkLabel = document.querySelector("#talk-label");
  const stopButton = document.querySelector("#stop-button");
  const caption = document.querySelector("#caption");
  const avatar = document.querySelector("#avatar-frame");
  const avatarImage = avatar.querySelector("img");
  const status = document.querySelector("#connection-status");
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const GREETING = "Hi, I’m Mabel. I’m here with you. Just start talking whenever you’re ready.";
  const PIPER_VOICE = "en_GB-alba-medium";
  const MODEL_COMPLETION_DEADLINE_MS = 5000;
  const TOTAL_RESPONSE_DEADLINE_MS = 7000;
  const AVATAR_FRAMES = [
    "./public/assets/mabel-portrait.png?v=20260718-9",
    "./public/assets/mabel-speak-mid.png?v=20260718-9",
    "./public/assets/mabel-speak-open.png?v=20260718-9"
  ];

  let micStream;
  let audioContext;
  let vadNode;
  let conversationActive = false;
  let listeningActive = false;
  let capturingUser = false;
  let processing = false;
  let speaking = false;
  let muted = false;
  let history = [];
  let activeTurn = 0;
  let activeRequestController;
  let activeRequestTimer;
  let currentAudio;
  let currentAudioResolve;
  let speechAnalyser;
  let speechSamples;
  let avatarAnimationRequest;
  let avatarFrame = 0;
  let avatarFrameUpdatedAt = 0;
  let speechTextQueue = [];
  let speechAudioQueue = [];
  let synthesisBusy = false;
  let synthesisBusyTurn = 0;
  let playbackBusy = false;
  let playbackBusyTurn = 0;
  let streamComplete = false;
  let synthesisComplete = false;

  AVATAR_FRAMES.forEach((src) => { const image = new Image(); image.src = src; });

  const setCaption = (text) => { caption.textContent = text; };
  const setStatus = (text) => { status.textContent = text; };

  const showAvatarFrame = (frame) => {
    if (avatarFrame === frame) return;
    avatarFrame = frame;
    avatarImage.src = AVATAR_FRAMES[frame];
  };

  const stopAvatarAnimation = () => {
    if (avatarAnimationRequest) cancelAnimationFrame(avatarAnimationRequest);
    avatarAnimationRequest = undefined;
    speechAnalyser = undefined;
    speechSamples = undefined;
    avatar.classList.remove("speaking");
    avatarFrame = -1;
    showAvatarFrame(0);
  };

  const animateAvatar = () => {
    if (!currentAudio || !speechAnalyser || !speechSamples) {
      stopAvatarAnimation();
      return;
    }
    const now = performance.now();
    if (now - avatarFrameUpdatedAt >= 85) {
      speechAnalyser.getByteTimeDomainData(speechSamples);
      let energy = 0;
      for (const sample of speechSamples) {
        const value = (sample - 128) / 128;
        energy += value * value;
      }
      const rms = Math.sqrt(energy / speechSamples.length);
      showAvatarFrame(rms < 0.018 ? 0 : rms < 0.075 ? 1 : 2);
      avatarFrameUpdatedAt = now;
    }
    avatarAnimationRequest = requestAnimationFrame(animateAvatar);
  };

  const setVadMode = (mode, resetCapture = false) => {
    vadNode?.port.postMessage({ type: "mode", mode, resetCapture });
  };

  const startListening = () => {
    if (!conversationActive || muted || processing || speaking || capturingUser) return;
    listeningActive = true;
    setVadMode("listening", true);
    setStatus("Listening");
    setCaption("I’m listening.");
  };

  const stopCurrentAudio = () => {
    const source = currentAudio;
    const resolve = currentAudioResolve;
    currentAudio = undefined;
    currentAudioResolve = undefined;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch (_) {}
    }
    stopAvatarAnimation();
    resolve?.();
  };

  const clearRequest = () => {
    window.clearTimeout(activeRequestTimer);
    activeRequestTimer = undefined;
    activeRequestController = undefined;
  };

  const resetSpeechQueues = () => {
    speechTextQueue = [];
    speechAudioQueue = [];
    streamComplete = false;
    synthesisComplete = false;
  };

  const cancelActiveTurn = (resumeListening = true, preserveVadCapture = false) => {
    activeTurn += 1;
    activeRequestController?.abort();
    clearRequest();
    resetSpeechQueues();
    stopCurrentAudio();
    processing = false;
    speaking = false;
    stopButton.hidden = true;
    if (!preserveVadCapture) setVadMode("inactive", true);
    if (resumeListening && !muted) window.setTimeout(startListening, 80);
    return activeTurn;
  };

  const beginRequest = (turn, timeoutMs, timeoutMessage = "The request timed out.") => {
    if (turn !== activeTurn) throw new DOMException("Turn cancelled", "AbortError");
    activeRequestController?.abort();
    window.clearTimeout(activeRequestTimer);
    const controller = new AbortController();
    activeRequestController = controller;
    activeRequestTimer = window.setTimeout(() => {
      controller.abort(new DOMException(timeoutMessage, "TimeoutError"));
    }, timeoutMs);
    return controller;
  };

  const encodeWav = (pcm, sampleRate) => {
    const buffer = new ArrayBuffer(44 + (pcm.length * 2));
    const view = new DataView(buffer);
    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + (pcm.length * 2), true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    for (let index = 0; index < pcm.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, pcm[index]));
      view.setInt16(44 + (index * 2), sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  const extractStreamText = (payload) => {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    return payload.choices?.[0]?.delta?.content
      || payload.choices?.[0]?.message?.content
      || payload.delta?.content
      || payload.response
      || payload.output_text
      || "";
  };

  const queueSpeechText = (text, turn, deadlineAt) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean || turn !== activeTurn) return;
    speechTextQueue.push({ text: clean, turn, deadlineAt });
    if (!speaking && !currentAudio) {
      setStatus("Preparing voice — you can interrupt");
      setCaption(clean);
    }
    pumpSynthesis(turn);
  };

  const drainSpeakableText = (state, turn, flush = false) => {
    const sentencePattern = /[.!?](?:["'”’)]*)(?:\s+|$)/g;
    const clausePattern = /[,;:](?:\s+|$)/g;
    while (state.pending.length) {
      const minimumClause = state.started ? 70 : 40;
      const maximumChunk = state.started ? 180 : 110;
      let splitAt = -1;
      let match;
      sentencePattern.lastIndex = 0;
      while ((match = sentencePattern.exec(state.pending))) {
        const candidate = match.index + match[0].length;
        if ((candidate >= 24 && candidate <= maximumChunk) || flush) {
          splitAt = candidate;
          break;
        }
      }
      if (splitAt < 0 && state.pending.length >= minimumClause) {
        clausePattern.lastIndex = 0;
        while ((match = clausePattern.exec(state.pending))) {
          const candidate = match.index + match[0].length;
          if (candidate >= minimumClause && candidate <= maximumChunk) {
            splitAt = candidate;
            break;
          }
        }
      }
      if (splitAt < 0 && state.pending.length > maximumChunk) {
        splitAt = state.pending.lastIndexOf(" ", maximumChunk);
        if (splitAt < minimumClause) splitAt = maximumChunk;
      }
      if (splitAt < 0) break;
      queueSpeechText(state.pending.slice(0, splitAt), turn, state.deadlineAt);
      state.started = true;
      state.pending = state.pending.slice(splitAt).trimStart();
    }
    if (flush && state.pending.trim()) {
      queueSpeechText(state.pending, turn, state.deadlineAt);
      state.started = true;
      state.pending = "";
    }
  };

  const playAudioBuffer = (audioBuffer, text, turn) => new Promise((resolve) => {
    if (turn !== activeTurn) {
      resolve();
      return;
    }
    const source = audioContext.createBufferSource();
    const outputAnalyser = audioContext.createAnalyser();
    outputAnalyser.fftSize = 256;
    outputAnalyser.smoothingTimeConstant = 0.5;
    source.buffer = audioBuffer;
    source.connect(outputAnalyser);
    outputAnalyser.connect(audioContext.destination);
    currentAudio = source;
    currentAudioResolve = resolve;
    speechAnalyser = outputAnalyser;
    speechSamples = new Uint8Array(outputAnalyser.fftSize);
    speaking = true;
    setVadMode("speaking", true);
    avatar.classList.add("speaking");
    stopButton.hidden = false;
    setStatus("Speaking — you can interrupt");
    setCaption(text);
    avatarAnimationRequest = requestAnimationFrame(animateAvatar);
    source.onended = () => {
      if (currentAudio === source) {
        currentAudio = undefined;
        currentAudioResolve = undefined;
        stopAvatarAnimation();
      }
      resolve();
    };
    source.start();
  });

  const finishVoiceTurn = (turn) => {
    if (turn !== activeTurn) return;
    processing = false;
    speaking = false;
    stopButton.hidden = true;
    stopCurrentAudio();
    setVadMode("inactive", true);
    window.setTimeout(startListening, 100);
  };

  const maybeFinishVoiceTurn = (turn) => {
    if (turn !== activeTurn) return;
    const synthesizingThisTurn = synthesisBusy && synthesisBusyTurn === turn;
    const playingThisTurn = playbackBusy && playbackBusyTurn === turn;
    if (streamComplete && synthesisComplete && !synthesizingThisTurn && !playingThisTurn && !speechAudioQueue.length && !currentAudio) {
      finishVoiceTurn(turn);
    }
  };

  const pumpPlayback = async (turn) => {
    if (playbackBusy || turn !== activeTurn) return;
    playbackBusy = true;
    playbackBusyTurn = turn;
    try {
      while (turn === activeTurn && speechAudioQueue.length) {
        const item = speechAudioQueue.shift();
        if (item.turn !== turn) continue;
        await playAudioBuffer(item.audioBuffer, item.text, turn);
      }
    } finally {
      if (playbackBusyTurn === turn) {
        playbackBusy = false;
        playbackBusyTurn = 0;
      }
      maybeFinishVoiceTurn(turn);
      if (speechAudioQueue.length && !playbackBusy) pumpPlayback(activeTurn);
    }
  };

  const pumpSynthesis = async (turn) => {
    if (synthesisBusy || turn !== activeTurn) return;
    synthesisBusy = true;
    synthesisBusyTurn = turn;
    try {
      while (turn === activeTurn && speechTextQueue.length) {
        const item = speechTextQueue.shift();
        if (item.turn !== turn) continue;
        if (!speaking && !currentAudio) setStatus("Preparing voice");
        const remaining = item.deadlineAt ? item.deadlineAt - performance.now() : Infinity;
        if (remaining <= 0) throw new DOMException("Mabel could not begin speaking within 7 seconds.", "TimeoutError");
        const synthesis = piperTts.predict({ text: item.text, voiceId: PIPER_VOICE }, ({ loaded, total }) => {
          if (turn !== activeTurn || !total) return;
          const percent = Math.min(100, Math.round((loaded / total) * 100));
          setStatus(`Loading Scottish voice — ${percent}%`);
        });
        const wav = Number.isFinite(remaining)
          ? await Promise.race([
              synthesis,
              new Promise((_, reject) => window.setTimeout(
                () => reject(new DOMException("Mabel could not begin speaking within 7 seconds.", "TimeoutError")),
                remaining
              ))
            ])
          : await synthesis;
        if (turn !== activeTurn) break;
        const audioBuffer = await audioContext.decodeAudioData(await wav.arrayBuffer());
        if (turn !== activeTurn) break;
        if (item.deadlineAt && performance.now() > item.deadlineAt) {
          throw new DOMException("Mabel could not begin speaking within 7 seconds.", "TimeoutError");
        }
        speechAudioQueue.push({ audioBuffer, text: item.text, turn });
        pumpPlayback(turn);
      }
    } catch (error) {
      if (turn === activeTurn) {
        setCaption(error.message || "Mabel’s voice could not be generated.");
        cancelActiveTurn(true);
      }
    } finally {
      if (synthesisBusyTurn === turn) {
        synthesisBusy = false;
        synthesisBusyTurn = 0;
      }
      if (turn === activeTurn && streamComplete && !speechTextQueue.length) synthesisComplete = true;
      maybeFinishVoiceTurn(turn);
      if (speechTextQueue.length && !synthesisBusy) pumpSynthesis(activeTurn);
    }
  };

  const markStreamComplete = (turn) => {
    if (turn !== activeTurn) return;
    streamComplete = true;
    if (!speechTextQueue.length && !(synthesisBusy && synthesisBusyTurn === turn)) synthesisComplete = true;
    else pumpSynthesis(turn);
    maybeFinishVoiceTurn(turn);
  };

  const speakStandalone = (text) => {
    const turn = cancelActiveTurn(false);
    processing = true;
    resetSpeechQueues();
    setVadMode("inactive", true);
    stopButton.hidden = false;
    setCaption(text);
    queueSpeechText(text, turn);
    markStreamComplete(turn);
  };

  const askMabel = async (transcript, turn) => {
    if (turn !== activeTurn) return;
    processing = true;
    resetSpeechQueues();
    setVadMode("inactive", true);
    stopButton.hidden = false;
    setStatus("Thinking");
    setCaption(`You said: “${transcript}”`);
    const messages = history.concat({ role: "user", content: transcript });
    const responseDeadlineAt = performance.now() + TOTAL_RESPONSE_DEADLINE_MS;
    const controller = beginRequest(turn, MODEL_COMPLETION_DEADLINE_MS, "Mabel did not complete her response within 5 seconds.");
    const speechState = { pending: "", started: false, deadlineAt: responseDeadlineAt };
    let answer = "";
    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        body: JSON.stringify({ messages }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) throw new Error("Mabel is unavailable right now.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      while (turn === activeTurn) {
        const { value, done } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let payload;
          try { payload = JSON.parse(data); } catch (_) { continue; }
          if (payload.error) throw new Error(payload.error);
          const delta = extractStreamText(payload);
          if (!delta) continue;
          answer += delta;
          speechState.pending += delta;
          setStatus("Responding — you can interrupt");
          setCaption(answer.trimStart());
          drainSpeakableText(speechState, turn);
        }
      }
      if (turn !== activeTurn) return;
      if (lineBuffer.startsWith("data:")) {
        const data = lineBuffer.slice(5).trim();
        if (data && data !== "[DONE]") {
          let payload;
          try { payload = JSON.parse(data); } catch (_) {}
          if (payload?.error) throw new Error(payload.error);
          if (payload) {
            const delta = extractStreamText(payload);
            answer += delta;
            speechState.pending += delta;
          }
        }
      }
      drainSpeakableText(speechState, turn, true);
      const cleanAnswer = answer.trim();
      if (!cleanAnswer) throw new Error("Mabel did not return a response.");
      setCaption(cleanAnswer);
      history = history.concat(
        { role: "user", content: transcript },
        { role: "assistant", content: cleanAnswer }
      ).slice(-12);
      clearRequest();
      markStreamComplete(turn);
    } catch (error) {
      if (turn !== activeTurn) return;
      clearRequest();
      setCaption(error.name === "TimeoutError"
        ? error.message
        : (error.message || "Mabel could not complete that response."));
      cancelActiveTurn(true);
    }
  };

  const transcribeAudio = async (pcmBuffer, sampleRate) => {
    const turn = cancelActiveTurn(false);
    processing = true;
    capturingUser = false;
    listeningActive = false;
    setVadMode("inactive", true);
    setStatus("Understanding");
    setCaption("Mabel is listening to what you said…");
    const controller = beginRequest(turn, 30000, "Mabel could not understand the audio in time.");
    try {
      const transcribeUrl = config.apiUrl.replace(/\/chat\/?$/, "/transcribe");
      const audioBlob = encodeWav(new Float32Array(pcmBuffer), sampleRate);
      const response = await fetch(transcribeUrl, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: audioBlob,
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Mabel could not understand the audio.");
      const data = await response.json();
      const transcript = String(data.text || "").trim();
      clearRequest();
      if (turn !== activeTurn) return;
      if (!transcript) {
        processing = false;
        setCaption("I didn’t catch that. I’m still listening.");
        window.setTimeout(startListening, 150);
        return;
      }
      setCaption(`“${transcript}”`);
      await askMabel(transcript, turn);
    } catch (error) {
      if (turn !== activeTurn || error.name === "AbortError") return;
      clearRequest();
      processing = false;
      setCaption(error.message || "Mabel could not understand the audio.");
      window.setTimeout(startListening, 250);
    }
  };

  const setupVoicePipeline = async () => {
    audioContext = new AudioContextClass();
    await audioContext.audioWorklet.addModule("./mabel-vad-worklet.js?v=20260718-1");
    const source = audioContext.createMediaStreamSource(micStream);
    vadNode = new AudioWorkletNode(audioContext, "mabel-vad");
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    source.connect(vadNode);
    vadNode.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    vadNode.port.onmessage = ({ data }) => {
      if (data?.type === "speechstart" && listeningActive && !muted) {
        listeningActive = false;
        capturingUser = true;
        setStatus("Hearing you");
        setCaption("I can hear you…");
      }
      if (data?.type === "bargein" && !muted && speaking) {
        capturingUser = true;
        listeningActive = false;
        cancelActiveTurn(false, true);
        setStatus("Hearing you");
        setCaption("I can hear you…");
      }
      if (data?.type === "utterance" && !muted) transcribeAudio(data.pcm, data.sampleRate);
    };
  };

  const toggleMicrophone = () => {
    muted = !muted;
    micStream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    talkButton.classList.toggle("muted", muted);
    talkButton.classList.toggle("listening", !muted);
    talkButton.setAttribute("aria-pressed", String(muted));
    talkButton.setAttribute("aria-label", muted ? "Unmute Mabel's microphone" : "Mute Mabel's microphone");
    talkLabel.textContent = muted ? "Microphone off" : "Microphone on";
    if (muted) {
      capturingUser = false;
      listeningActive = false;
      setVadMode("inactive", true);
      setStatus(speaking ? "Speaking" : processing ? "Thinking" : "Microphone off");
    } else if (speaking || processing) {
      setVadMode(speaking ? "speaking" : "inactive", true);
      setStatus(speaking ? "Speaking — you can interrupt" : "Thinking");
    } else {
      startListening();
    }
  };

  allowButton.addEventListener("click", async () => {
    permissionError.hidden = true;
    allowButton.disabled = true;
    allowButton.textContent = "Waiting for microphone permission…";
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass || !window.AudioWorkletNode) {
      permissionError.hidden = false;
      permissionError.textContent = "This browser does not support the voice conversation required for Mabel.";
      allowButton.disabled = false;
      allowButton.textContent = "Try microphone again";
      return;
    }
    let permissionTimer;
    try {
      let permission = null;
      try { permission = await navigator.permissions?.query({ name: "microphone" }); } catch (_) {}
      if (permission?.state === "denied") {
        throw new Error("Microphone access is blocked for this site. Allow it from the microphone icon in the address bar, then try again.");
      }
      permissionTimer = window.setTimeout(() => {
        permissionError.hidden = false;
        permissionError.textContent = "Your browser is waiting for microphone permission. Choose Allow from the microphone prompt or the icon in the address bar.";
      }, 2500);
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      window.clearTimeout(permissionTimer);
      allowButton.textContent = "Starting Mabel…";
      await setupVoicePipeline();
      await audioContext.resume();
      conversationActive = true;
      permissionScreen.hidden = true;
      conversationScreen.hidden = false;
      setVadMode("inactive", true);
      setStatus("Calibrating microphone");
      setCaption("Mabel is adjusting to the room…");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      speakStandalone(GREETING);
    } catch (error) {
      window.clearTimeout(permissionTimer);
      permissionError.hidden = false;
      permissionError.textContent = error.message || "Microphone access is required to begin a voice conversation with Mabel.";
      allowButton.disabled = false;
      allowButton.textContent = "Try microphone again";
    }
  });

  talkButton.addEventListener("click", toggleMicrophone);
  stopButton.addEventListener("click", () => cancelActiveTurn(true));
  window.addEventListener("beforeunload", () => {
    conversationActive = false;
    cancelActiveTurn(false);
    micStream?.getTracks().forEach((track) => track.stop());
    vadNode?.disconnect();
    audioContext?.close();
  });
})();
