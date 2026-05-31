import { NextRequest } from "next/server";

/** Strip Chinese characters so TTS never accidentally reads Chinese */
function stripChinese(s: string): string {
  return s.replace(/[一-鿿㐀-䶿＀-￯]+/g, "").trim();
}

// ─── Per-IP conversation memory ───
// In production (EdgeOne Pages Cloud Functions) this lives as long as the
// runtime process stays warm.  For persistent storage, swap in Redis later.
const store = new Map<
  string,
  { role: "user" | "assistant"; content: string }[]
>();
const MAX_TURNS = 10; // remember last 10 exchanges per IP

function getHistory(ip: string) {
  if (!store.has(ip)) store.set(ip, []);
  return store.get(ip)!;
}

function pushEntry(
  ip: string,
  entry: { role: "user" | "assistant"; content: string }
) {
  const h = getHistory(ip);
  h.push(entry);
  // Keep only the latest N turns (each turn = one user + one assistant)
  if (h.length > MAX_TURNS * 2) {
    store.set(ip, h.slice(-(MAX_TURNS * 2)));
  }
}

function extractIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

// ─── System prompt ───
const SYSTEM_PROMPT =
  "你是一个英语陪练助手。用户会对你说中文。请按以下 JSON 格式回复（不要包含其他文字）：\n" +
  "{\n" +
  '  "user_en": "用户中文的英文翻译（自然口语化）",\n' +
  '  "reply_en": "你对用户的英文回复（简短口语，2-3句话，适合语音合成，结合历史对话保持上下文连贯）",\n' +
  '  "reply_zh": "你英文回复的中文翻译"\n' +
  "}\n\n" +
  "示例：\n" +
  '用户说："今天工作好累"\n' +
  '回复：{"user_en": "I had a really tiring day at work.", "reply_en": "I hear you! Working hard can really drain your energy. Make sure to get some good rest tonight.", "reply_zh": "我理解！努力工作确实很消耗精力。今晚一定要好好休息。"}';

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  const { text } = await request.json();
  if (!text) {
    return Response.json({ error: "请输入文本" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({
      user_en: text,
      reply_en: "Please configure your API key to start practicing.",
      reply_zh: "请配置 API 密钥后开始练习。",
      note: "未配置 DeepSeek API Key",
    });
  }

  const ip = extractIP(request);
  const history = getHistory(ip);

  // Build full message list: system + prior turns + current user message
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...history,
    { role: "user" as const, content: text },
  ];

  const t1 = Date.now();
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      stream: false,
      max_tokens: 200,
      temperature: 0.3,
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  const t2 = Date.now();

  // Persist this turn
  pushEntry(ip, { role: "user", content: text });
  pushEntry(ip, { role: "assistant", content });

  try {
    const parsed = JSON.parse(content);
    return Response.json({
      user_en: parsed.user_en || text,
      reply_en: stripChinese(parsed.reply_en || content),
      reply_zh: parsed.reply_zh || content,
      timing: { parse: t1 - t0, deepseek: t2 - t1 },
    });
  } catch {
    const englishOnly = stripChinese(content);
    return Response.json({
      user_en: text,
      reply_en: englishOnly || content,
      reply_zh: content,
      timing: { parse: t1 - t0, deepseek: t2 - t1 },
    });
  }
}
