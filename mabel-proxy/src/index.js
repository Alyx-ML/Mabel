const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
const SYSTEM_PROMPT = `You are Mabel, an AI companion speaking directly with the user. Your name is Mabel. Always refer to yourself as Mabel. Never identify yourself as Kira. Kira is the name of the original project this application was adapted from, not your identity. Do not inherit Kira's memories, biography, achievements, relationships, creator identity, or personal history. If the user calls you Kira, briefly clarify that your name is Mabel. Speak naturally and conversationally. Do not mention the underlying model provider or implementation unless the user asks a technical question. Keep spoken answers concise unless the user asks for depth.`;
const allowedOrigins = new Set(["https://alyx-ml.github.io", "http://localhost:8787", "http://127.0.0.1:4173"]);
function cors(request) { const origin = request.headers.get("Origin"); return {"Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://alyx-ml.github.io", "Access-Control-Allow-Methods":"POST, OPTIONS", "Access-Control-Allow-Headers":"Content-Type", "Cache-Control":"no-store", "Vary":"Origin"}; }

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export default {
  async fetch(request, env) {
    const headers = cors(request);
    if (request.method === "OPTIONS") return new Response(null,{headers});
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/chat", "/transcribe"].includes(path)) return new Response("Not found",{status:404,headers});
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
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 60_000) return Response.json({error:"Conversation is too large."},{status:413,headers});
      const {messages} = await request.json();
      if (!Array.isArray(messages) || messages.length === 0 || messages.length > 12) return Response.json({error:"Invalid conversation."},{status:400,headers});
      const clean = messages.map(({role,content}) => ({role: role === "assistant" ? "assistant" : "user", content:String(content).slice(0,4000)}));
      const stream = await env.AI.run(MODEL,{
        messages:[{role:"system",content:SYSTEM_PROMPT},...clean],
        stream:true,
        reasoning_effort:"none",
        max_tokens:400,
        temperature:0.75
      });
      return new Response(stream,{headers:{...headers,"Content-Type":"text/event-stream; charset=utf-8","Content-Encoding":"identity","X-Content-Type-Options":"nosniff"}});
    } catch (error) {
      console.error(JSON.stringify({route:path,error:error?.name || "Error",message:String(error?.message || "Unknown failure").slice(0,240)}));
      return Response.json({error:"Mabel could not complete that response."},{status:502,headers});
    }
  }
};
