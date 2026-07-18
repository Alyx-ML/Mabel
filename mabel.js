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
  let recognition; let micStream; let speaking = false; let processing = false; let history = [];

  const setState = (text) => { caption.textContent = text; };
  const stopSpeaking = () => { window.speechSynthesis.cancel(); speaking = false; avatar.classList.remove("speaking"); stopButton.hidden = true; };
  const say = (text) => {
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    const preferred = speechSynthesis.getVoices().find((voice) => /Samantha|Serena|Karen|Google UK English Female/i.test(voice.name));
    if (preferred) utterance.voice = preferred;
    utterance.rate = .98; utterance.pitch = 1.02;
    utterance.onstart = () => { speaking = true; avatar.classList.add("speaking"); stopButton.hidden = false; status.textContent = "Speaking"; };
    utterance.onend = utterance.onerror = () => { speaking = false; avatar.classList.remove("speaking"); stopButton.hidden = true; if (!processing) status.textContent = "Ready"; };
    speechSynthesis.speak(utterance);
  };
  const askMabel = async (transcript) => {
    processing = true; status.textContent = "Thinking"; setState("Mabel is thinking…");
    const response = await fetch(config.apiUrl, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({messages:history.concat({role:"user",content:transcript})}) });
    if (!response.ok) throw new Error("Mabel is unavailable right now.");
    const data = await response.json(); const answer = data.reply;
    history = history.concat({role:"user",content:transcript},{role:"assistant",content:answer}).slice(-12);
    setState(answer); processing = false; say(answer);
  };
  const setupRecognition = () => {
    recognition = new SpeechRecognition(); recognition.continuous = false; recognition.interimResults = true; recognition.lang = navigator.language || "en-GB";
    recognition.onstart = () => { talkButton.classList.add("listening"); talkLabel.textContent = "Listening…"; status.textContent = "Listening"; setState("I’m listening."); };
    recognition.onresult = (event) => { const result = event.results[event.results.length - 1]; const text = result[0].transcript.trim(); if (result.isFinal && text) { setState(`“${text}”`); askMabel(text).catch((error) => { processing=false; status.textContent="Ready"; setState(error.message); }); } };
    recognition.onend = () => { talkButton.classList.remove("listening"); talkLabel.textContent = "Hold to talk"; if (!processing && !speaking) status.textContent="Ready"; };
    recognition.onerror = (event) => { if (event.error !== "aborted") { setState("I didn’t catch that. Hold to talk and try again."); } };
  };
  const beginListening = () => { if (processing) return; stopSpeaking(); try { recognition.start(); } catch (_) {} };
  const finishListening = () => { if (recognition) recognition.stop(); };
  allowButton.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || !SpeechRecognition) { permissionError.hidden=false; permissionError.textContent="This browser does not support the voice conversation required for Mabel."; return; }
    try { micStream = await navigator.mediaDevices.getUserMedia({audio:true}); setupRecognition(); permissionScreen.hidden=true; conversationScreen.hidden=false; setState("I’m here. Tap and hold to talk."); }
    catch { permissionError.hidden=false; permissionError.textContent="Microphone access is required to begin a voice conversation with Mabel."; }
  });
  ["pointerdown","touchstart"].forEach((event) => talkButton.addEventListener(event, beginListening));
  ["pointerup","pointerleave","touchend","touchcancel"].forEach((event) => talkButton.addEventListener(event, finishListening));
  stopButton.addEventListener("click", stopSpeaking);
  window.addEventListener("beforeunload", () => micStream?.getTracks().forEach((track) => track.stop()));
})();
