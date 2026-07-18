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
  const status = document.querySelector("#connection-status");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const GREETING = "Hi, I’m Mabel. I’m here with you. Just start talking whenever you’re ready.";

  let recognition;
  let micStream;
  let audioContext;
  let analyser;
  let recognitionActive = false;
  let conversationActive = false;
  let speaking = false;
  let processing = false;
  let muted = false;
  let handledFinal = false;
  let history = [];
  let loudFrames = 0;
  let currentAudio;
  let speechRequest;

  const setCaption = (text) => { caption.textContent = text; };
  const setStatus = (text) => { status.textContent = text; };

  const startListening = () => {
    if (!conversationActive || muted || processing || speaking || recognitionActive) return;
    handledFinal = false;
    try { recognition.start(); } catch (_) {}
  };

  const stopRecognition = () => {
    if (!recognitionActive) return;
    try { recognition.abort(); } catch (_) {}
    recognitionActive = false;
  };

  const finishSpeech = () => {
    currentAudio = undefined;
    speechRequest = undefined;
    speaking = false;
    avatar.classList.remove("speaking");
    stopButton.hidden = true;
    if (!processing && !muted) {
      setStatus("Listening");
      setCaption("I’m listening.");
      window.setTimeout(startListening, 120);
    }
  };

  const stopSpeaking = (resumeListening = true) => {
    speechRequest?.abort();
    speechRequest = undefined;
    if (currentAudio) {
      currentAudio.onended = null;
      try { currentAudio.stop(); } catch (_) {}
    }
    currentAudio = undefined;
    speaking = false;
    avatar.classList.remove("speaking");
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
    speechRequest = new AbortController();
    try {
      const ttsUrl = config.apiUrl.replace(/\/chat\/?$/, "/tts");
      const response = await fetch(ttsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: speechRequest.signal
      });
      if (!response.ok) throw new Error("Mabel’s voice could not be generated.");
      const audioData = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(audioData);
      currentAudio = audioContext.createBufferSource();
      currentAudio.buffer = audioBuffer;
      currentAudio.connect(audioContext.destination);
      currentAudio.onended = finishSpeech;
      speaking = true;
      loudFrames = 0;
      avatar.classList.add("speaking");
      stopButton.hidden = false;
      setStatus("Speaking — you can interrupt");
      currentAudio.start();
    } catch (error) {
      if (error.name === "AbortError") return;
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

  const setupRecognition = () => {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-GB";

    recognition.onstart = () => {
      recognitionActive = true;
      talkButton.classList.add("listening");
      setStatus("Listening");
      setCaption("I’m listening.");
    };

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const text = result[0].transcript.trim();
      if (!text) return;
      if (!result.isFinal) {
        setCaption(`“${text}”`);
        return;
      }
      if (handledFinal) return;
      handledFinal = true;
      setCaption(`“${text}”`);
      stopRecognition();
      askMabel(text);
    };

    recognition.onend = () => {
      recognitionActive = false;
      if (conversationActive && !muted && !processing && !speaking) {
        window.setTimeout(startListening, 180);
      }
    };

    recognition.onerror = (event) => {
      recognitionActive = false;
      if (["aborted", "no-speech"].includes(event.error)) return;
      setCaption("I didn’t catch that. I’m still listening.");
      if (!muted && !processing && !speaking) window.setTimeout(startListening, 400);
    };
  };

  const setupBargeIn = () => {
    audioContext = new AudioContext();
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
      if (speaking && !muted && rms > 0.075) loudFrames += 1;
      else loudFrames = Math.max(0, loudFrames - 1);
      if (speaking && loudFrames >= 5) {
        loudFrames = 0;
        stopSpeaking(true);
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
    if (!navigator.mediaDevices?.getUserMedia || !SpeechRecognition) {
      permissionError.hidden = false;
      permissionError.textContent = "This browser does not support the voice conversation required for Mabel.";
      return;
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      setupRecognition();
      setupBargeIn();
      await audioContext.resume();
      conversationActive = true;
      permissionScreen.hidden = true;
      conversationScreen.hidden = false;
      setCaption(GREETING);
      await say(GREETING);
    } catch (_) {
      permissionError.hidden = false;
      permissionError.textContent = "Microphone access is required to begin a voice conversation with Mabel.";
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
