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
  const AVATAR_FRAMES = [
    "./public/assets/mabel-portrait.png?v=20260718-9",
    "./public/assets/mabel-speak-mid.png?v=20260718-9",
    "./public/assets/mabel-speak-open.png?v=20260718-9"
  ];

  let recorder;
  let micStream;
  let audioContext;
  let analyser;
  let speechAnalyser;
  let speechSamples;
  let recognitionActive = false;
  let listeningActive = false;
  let conversationActive = false;
  let speaking = false;
  let processing = false;
  let muted = false;
  let history = [];
  let loudFrames = 0;
  let speechFrames = 0;
  let audioChunks = [];
  let discardRecording = false;
  let lastVoiceAt = 0;
  let recordingStartedAt = 0;
  let currentAudio;
  let speechStartedAt = 0;
  let avatarFrame = 0;
  let avatarFrameUpdatedAt = 0;

  AVATAR_FRAMES.forEach((src) => { const image = new Image(); image.src = src; });

  const setCaption = (text) => { caption.textContent = text; };
  const setStatus = (text) => { status.textContent = text; };

  const showAvatarFrame = (frame) => {
    if (avatarFrame === frame) return;
    avatarFrame = frame;
    avatarImage.src = AVATAR_FRAMES[frame];
  };

  const resetAvatarFrame = () => {
    avatarFrame = -1;
    showAvatarFrame(0);
  };

  const startListening = () => {
    if (!conversationActive || muted || processing || speaking || listeningActive) return;
    listeningActive = true;
    speechFrames = 0;
    setStatus("Listening");
    setCaption("I’m listening.");
  };

  const stopRecognition = () => {
    listeningActive = false;
    speechFrames = 0;
    if (recorder && recorder.state !== "inactive") {
      discardRecording = true;
      recorder.stop();
    }
  };

  const transcribeAudio = async (audioBlob) => {
    processing = true;
    setStatus("Understanding");
    setCaption("Mabel is listening to what you said…");
    try {
      const transcribeUrl = config.apiUrl.replace(/\/chat\/?$/, "/transcribe");
      const response = await fetch(transcribeUrl, {
        method: "POST",
        headers: { "Content-Type": audioBlob.type || "application/octet-stream" },
        body: audioBlob
      });
      if (!response.ok) throw new Error("Mabel could not understand the audio.");
      const data = await response.json();
      const transcript = String(data.text || "").trim();
      if (!transcript) {
        processing = false;
        setCaption("I didn’t catch that. I’m still listening.");
        window.setTimeout(startListening, 150);
        return;
      }
      setCaption(`“${transcript}”`);
      processing = false;
      await askMabel(transcript);
    } catch (error) {
      processing = false;
      setCaption(error.message || "Mabel could not understand the audio.");
      setStatus("Listening");
      window.setTimeout(startListening, 250);
    }
  };

  const beginRecording = () => {
    if (!listeningActive || recognitionActive || muted || processing || speaking) return;
    const preferredType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    recorder = preferredType ? new MediaRecorder(micStream, { mimeType: preferredType }) : new MediaRecorder(micStream);
    audioChunks = [];
    discardRecording = false;
    recognitionActive = true;
    listeningActive = false;
    recordingStartedAt = performance.now();
    lastVoiceAt = recordingStartedAt;
    recorder.ondataavailable = (event) => {
      if (event.data.size) audioChunks.push(event.data);
    };
    recorder.onstop = () => {
      const shouldTranscribe = !discardRecording && audioChunks.length > 0;
      const mimeType = recorder?.mimeType || preferredType || "application/octet-stream";
      recognitionActive = false;
      recorder = undefined;
      if (shouldTranscribe) transcribeAudio(new Blob(audioChunks, { type: mimeType }));
      else if (conversationActive && !muted && !processing && !speaking) window.setTimeout(startListening, 100);
    };
    recorder.start(100);
    setStatus("Hearing you");
    setCaption("I can hear you…");
  };

  const finishRecording = () => {
    if (!recorder || recorder.state === "inactive") return;
    discardRecording = false;
    setStatus("Understanding");
    recorder.stop();
  };

  const finishSpeech = () => {
    currentAudio = undefined;
    speechAnalyser = undefined;
    speechSamples = undefined;
    speaking = false;
    avatar.classList.remove("speaking");
    resetAvatarFrame();
    stopButton.hidden = true;
    if (!processing && !muted) {
      setStatus("Listening");
      setCaption("I’m listening.");
      window.setTimeout(startListening, 120);
    }
  };

  const stopSpeaking = (resumeListening = true) => {
    if (currentAudio) {
      currentAudio.onended = null;
      try { currentAudio.stop(); } catch (_) {}
    }
    currentAudio = undefined;
    speechAnalyser = undefined;
    speechSamples = undefined;
    speaking = false;
    avatar.classList.remove("speaking");
    resetAvatarFrame();
    stopButton.hidden = true;
    if (resumeListening && !processing && !muted) {
      setStatus("Listening");
      setCaption("I’m listening.");
      window.setTimeout(startListening, 80);
    }
  };

  const say = async (text) => {
    stopRecognition();
    stopSpeaking(false);
    setStatus("Preparing voice");
    try {
      const wav = await piperTts.predict({ text, voiceId: PIPER_VOICE }, ({ loaded, total }) => {
        if (!total) return;
        const percent = Math.min(100, Math.round((loaded / total) * 100));
        setStatus(`Loading Scottish voice — ${percent}%`);
        setCaption("Mabel is loading her voice for the first time…");
      });
      const audioBuffer = await audioContext.decodeAudioData(await wav.arrayBuffer());
      currentAudio = audioContext.createBufferSource();
      currentAudio.buffer = audioBuffer;
      speechAnalyser = audioContext.createAnalyser();
      speechAnalyser.fftSize = 256;
      speechAnalyser.smoothingTimeConstant = 0.5;
      speechSamples = new Uint8Array(speechAnalyser.fftSize);
      currentAudio.connect(speechAnalyser);
      speechAnalyser.connect(audioContext.destination);
      currentAudio.onended = finishSpeech;
      speaking = true;
      speechStartedAt = performance.now();
      loudFrames = 0;
      avatar.classList.add("speaking");
      showAvatarFrame(1);
      stopButton.hidden = false;
      setStatus("Speaking — you can interrupt");
      currentAudio.start();
    } catch (error) {
      setCaption(error.message || "Mabel’s voice could not be generated.");
      finishSpeech();
    }
  };

  const askMabel = async (transcript) => {
    processing = true;
    setStatus("Thinking");
    setCaption("Mabel is thinking…");
    try {
      const messages = history.concat({ role: "user", content: transcript });
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
      });
      if (!response.ok) throw new Error("Mabel is unavailable right now.");
      const data = await response.json();
      const answer = data.reply;
      history = history.concat(
        { role: "user", content: transcript },
        { role: "assistant", content: answer }
      ).slice(-12);
      processing = false;
      setCaption(answer);
      await say(answer);
    } catch (error) {
      processing = false;
      setCaption(error.message);
      setStatus("Listening");
      window.setTimeout(startListening, 250);
    }
  };

  const setupBargeIn = () => {
    audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.45;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const monitor = () => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const value = (sample - 128) / 128;
        energy += value * value;
      }
      const rms = Math.sqrt(energy / samples.length);
      if (speaking && speechAnalyser && speechSamples) {
        const now = performance.now();
        if (now - avatarFrameUpdatedAt >= 85) {
          speechAnalyser.getByteTimeDomainData(speechSamples);
          let speechEnergy = 0;
          for (const sample of speechSamples) {
            const value = (sample - 128) / 128;
            speechEnergy += value * value;
          }
          const speechRms = Math.sqrt(speechEnergy / speechSamples.length);
          showAvatarFrame(speechRms < 0.018 ? 0 : speechRms < 0.075 ? 1 : 2);
          avatarFrameUpdatedAt = now;
        }
      }
      if (speaking && performance.now() - speechStartedAt > 650 && !muted && rms > 0.08) loudFrames += 1;
      else loudFrames = Math.max(0, loudFrames - 1);
      if (speaking && loudFrames >= 5) {
        loudFrames = 0;
        stopSpeaking(true);
      }
      if (listeningActive && !muted && !processing && !speaking) {
        if (rms > 0.018) speechFrames += 1;
        else speechFrames = Math.max(0, speechFrames - 1);
        if (speechFrames >= 3) beginRecording();
      }
      if (recognitionActive && recorder?.state === "recording") {
        const now = performance.now();
        if (rms > 0.012) lastVoiceAt = now;
        const spokenFor = now - recordingStartedAt;
        if ((spokenFor > 500 && now - lastVoiceAt > 500) || spokenFor > 20000) finishRecording();
      }
      requestAnimationFrame(monitor);
    };
    monitor();
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
      stopRecognition();
      setStatus(speaking ? "Speaking" : "Microphone off");
    } else {
      setStatus("Listening");
      setCaption("I’m listening.");
      startListening();
    }
  };

  allowButton.addEventListener("click", async () => {
    permissionError.hidden = true;
    allowButton.disabled = true;
    allowButton.textContent = "Waiting for microphone permission…";
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !AudioContextClass) {
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
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      window.clearTimeout(permissionTimer);
      allowButton.textContent = "Starting Mabel…";
      setupBargeIn();
      await audioContext.resume();
      conversationActive = true;
      permissionScreen.hidden = true;
      conversationScreen.hidden = false;
      setCaption(GREETING);
      say(GREETING);
    } catch (error) {
      window.clearTimeout(permissionTimer);
      permissionError.hidden = false;
      permissionError.textContent = error.message || "Microphone access is required to begin a voice conversation with Mabel.";
      allowButton.disabled = false;
      allowButton.textContent = "Try microphone again";
    }
  });

  talkButton.addEventListener("click", toggleMicrophone);
  stopButton.addEventListener("click", () => stopSpeaking(true));
  window.addEventListener("beforeunload", () => {
    conversationActive = false;
    stopRecognition();
    stopSpeaking(false);
    micStream?.getTracks().forEach((track) => track.stop());
    audioContext?.close();
  });
})();
