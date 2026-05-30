import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { text, speaker } = await request.json();

  // TODO: 接入本地 XTTS-v2 服务
  // const res = await fetch("http://YOUR_SERVER:8000/tts", {
  //   method: "POST",
  //   body: new URLSearchParams({ text, language: "en" }),
  // });

  // 返回模拟音频（一段静音占位）
  return new Response("TTS 服务未连接", { status: 503 });
}
