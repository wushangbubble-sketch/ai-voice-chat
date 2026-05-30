import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { text } = await request.json();

  if (!text) {
    return Response.json({ error: "请输入文本" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ reply: text, note: "未配置 DeepSeek API Key，返回原文" });
  }

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "你是一个英语陪练助手。用户会对你说中文，你需要将其翻译成自然地道的美式英语口语并回复。回复应该简短口语化，适合语音合成，长度控制在 2-3 句话。不需要解释，直接输出英文回复。",
        },
        { role: "user", content: text },
      ],
      stream: false,
    }),
  });

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || text;

  return Response.json({ reply });
}
