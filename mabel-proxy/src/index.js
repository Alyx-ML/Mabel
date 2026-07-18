const MODEL = "@cf/openai/gpt-oss-120b";
const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
const SPEECH_MODEL = "@cf/myshell-ai/melotts";
const SYSTEM_PROMPT = `You are Mabel, an AI companion speaking directly with the user. Your name is Mabel. Always refer to yourself as Mabel. Never identify yourself as Kira. Kira is the name of the original project this application was adapted from, not your identity. Do not inherit Kira's memories, biography, achievements, relationships, creator identity, or personal history. If the user calls you Kira, briefly clarify that your name is Mabel. Speak naturally and conversationally. Do not mention the underlying model provider or implementation unless the user asks a technical question. Keep spoken answers concise unless the user asks for depth.`;
const allowedOrigins = new Set(["https://alyx-ml.github.io", "http://localhost:8787", "http://127.0.0.1:4173"]);
function cors(request) { const origin = request.headers.get("Origin"); return {"Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://alyx-ml.github.io", "Access-Control-Allow-Methods":"POST, OPTIONS", "Access-Control-Allow-Headers":"Content-Type", "Vary":"Origin"}; }

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function synthesizeSpeech(text, env) {
  const result = await env.AI.run(SPEECH_MODEL, { prompt: text, lang: "en" });
  if (result instanceof ReadableStream) return result;
  if (result?.audio) return decodeBase64(result.audio);
  throw new Error("No speech audio returned");
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
    if (request.method !== "POST" || !["/chat", "/tts", "/transcribe"].includes(path)) return new Response("Not found",{status:404,headers});
    try {
      if (path === "/transcribe") {
        const contentLength = Number(request.headers.get("Content-Length") || 0);
        if (contentLength > 10_000_000) return Response.json({error:"Audio is too large."},{status:413,headers});
        const audio = await request.arrayBuffer();
        if (audio.byteLength < 1000 || audio.byteLength > 10_000_000) return Response.json({error:"Invalid audio."},{status:400,headers});
        const result = await env.AI.run(TRANSCRIPTION_MODEL, {
          audio: encodeBase64(audio),
          language: "en",
          vad_filter: true,
          condition_on_previous_text: false,
          initial_prompt: "Natural conversational speech addressed to an AI companion named Mabel."
        });
        const text = String(result.text || "").trim();
        return Response.json({text},{headers});
      }
      if (path === "/tts") {
        const {text} = await request.json();
        const cleanText = String(text || "").trim().slice(0, 3000);
        if (!cleanText) return Response.json({error:"Invalid speech text."},{status:400,headers});
        const audio = await synthesizeSpeech(cleanText, env);
        return new Response(audio,{headers:{...headers,"Content-Type":"audio/wav","Cache-Control":"no-store"}});
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
