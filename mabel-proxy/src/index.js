const MODEL = "@cf/openai/gpt-oss-120b";
const SYSTEM_PROMPT = `You are Mabel, an AI companion speaking directly with the user. Your name is Mabel. Always refer to yourself as Mabel. Never identify yourself as Kira. Kira is the name of the original project this application was adapted from, not your identity. Do not inherit Kira's memories, biography, achievements, relationships, creator identity, or personal history. If the user calls you Kira, briefly clarify that your name is Mabel. Speak naturally and conversationally. Do not mention the underlying model provider or implementation unless the user asks a technical question. Keep spoken answers concise unless the user asks for depth.`;
const allowedOrigins = new Set(["https://alyx-ml.github.io", "http://localhost:8787", "http://127.0.0.1:4173"]);
function cors(request) { const origin = request.headers.get("Origin"); return {"Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://alyx-ml.github.io", "Access-Control-Allow-Methods":"POST, OPTIONS", "Access-Control-Allow-Headers":"Content-Type", "Vary":"Origin"}; }

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pcmToWav(pcm, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length, true);
  new Uint8Array(buffer, 44).set(pcm);
  return buffer;
}

async function synthesizeSpeech(text, apiKey) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Speak this transcript exactly, in a warm, natural, conversational British voice. Do not add or remove words. Transcript: ${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
      }
    })
  });
  if (!response.ok) throw new Error("Speech generation failed");
  const data = await response.json();
  const encoded = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData?.data;
  if (!encoded) throw new Error("No speech audio returned");
  return pcmToWav(decodeBase64(encoded));
}

async function triage(lastUserMessage, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "Classify the user's conversational intent as exactly one of: casual, emotional, factual, creative, urgent. Output only the label." },
        { role: "user", content: lastUserMessage }
      ],
      temperature: 0,
      max_tokens: 8
    })
  });
  if (!response.ok) throw new Error("Triage request failed");
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim().toLowerCase() || "casual";
}

export default {
  async fetch(request, env) {
    const headers = cors(request);
    if (request.method === "OPTIONS") return new Response(null,{headers});
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/chat", "/tts"].includes(path)) return new Response("Not found",{status:404,headers});
    try {
      if (path === "/tts") {
        const {text} = await request.json();
        const cleanText = String(text || "").trim().slice(0, 3000);
        if (!cleanText) return Response.json({error:"Invalid speech text."},{status:400,headers});
        if (!env.GOOGLE_API_KEY) throw new Error("Speech is not configured");
        const wav = await synthesizeSpeech(cleanText, env.GOOGLE_API_KEY);
        return new Response(wav,{headers:{...headers,"Content-Type":"audio/wav","Cache-Control":"no-store"}});
      }
      const {messages} = await request.json();
      if (!Array.isArray(messages) || messages.length === 0 || messages.length > 12) return Response.json({error:"Invalid conversation."},{status:400,headers});
      const clean = messages.map(({role,content}) => ({role: role === "assistant" ? "assistant" : "user", content:String(content).slice(0,4000)}));
      if (!env.GROQ_API_KEY) throw new Error("Triage is not configured");
      const intent = await triage(clean[clean.length - 1].content, env.GROQ_API_KEY);
      const result = await env.AI.run(MODEL,{messages:[{role:"system",content:`${SYSTEM_PROMPT}\nCurrent conversational intent: ${intent}.`},...clean],max_tokens:400,temperature:0.8});
      const reply = result.response || result.choices?.[0]?.message?.content;
      if (!reply) throw new Error("No model response");
      return Response.json({reply},{headers});
    } catch (error) { return Response.json({error:"Mabel could not complete that response."},{status:502,headers}); }
  }
};
