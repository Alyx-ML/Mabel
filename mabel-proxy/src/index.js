const MODEL = "@cf/openai/gpt-oss-120b";
const SYSTEM_PROMPT = `You are Mabel, an AI companion speaking directly with the user. Your name is Mabel. Always refer to yourself as Mabel. Never identify yourself as Kira. Kira is the name of the original project this application was adapted from, not your identity. Do not inherit Kira's memories, biography, achievements, relationships, creator identity, or personal history. If the user calls you Kira, briefly clarify that your name is Mabel. Speak naturally and conversationally. Do not mention the underlying model provider or implementation unless the user asks a technical question. Keep spoken answers concise unless the user asks for depth.`;
const allowedOrigins = new Set(["https://alyx-ml.github.io", "http://localhost:8787"]);
function cors(request) { const origin = request.headers.get("Origin"); return {"Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://alyx-ml.github.io", "Access-Control-Allow-Methods":"POST, OPTIONS", "Access-Control-Allow-Headers":"Content-Type", "Vary":"Origin"}; }
export default {
  async fetch(request, env) {
    const headers = cors(request);
    if (request.method === "OPTIONS") return new Response(null,{headers});
    if (request.method !== "POST" || new URL(request.url).pathname !== "/chat") return new Response("Not found",{status:404,headers});
    try {
      const {messages} = await request.json();
      if (!Array.isArray(messages) || messages.length === 0 || messages.length > 12) return Response.json({error:"Invalid conversation."},{status:400,headers});
      const clean = messages.map(({role,content}) => ({role: role === "assistant" ? "assistant" : "user", content:String(content).slice(0,4000)}));
      const result = await env.AI.run(MODEL,{messages:[{role:"system",content:SYSTEM_PROMPT},...clean],max_tokens:400,temperature:0.8});
      const reply = result.response || result.choices?.[0]?.message?.content;
      if (!reply) throw new Error("No model response");
      return Response.json({reply},{headers});
    } catch (error) { return Response.json({error:"Mabel could not complete that response."},{status:502,headers}); }
  }
};
