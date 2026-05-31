import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { text } = await request.json();

  if (!text) {
    return Response.json({ error: "请输入文本" }, { status: 400 });
  }

  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    return Response.json({ error: "TTS 未配置" }, { status: 503 });
  }

  try {
    const { v20190823 } = await import(
      "tencentcloud-sdk-nodejs-tts/tencentcloud/services/tts/v20190823"
    );

    const client = new v20190823.Client({
      credential: { secretId, secretKey },
      region: "ap-guangzhou",
      profile: {
        httpProfile: { endpoint: "tts.tencentcloudapi.com" },
      },
    });

    const data = await client.TextToVoice({
      Text: text,
      SessionId: crypto.randomUUID(),
      VoiceType: 200000000,
      FastVoiceType: "WCHN-80cb16a356db409dbef3a1389bc259cb",
      Codec: "wav",
      PrimaryLanguage: 2,
    });

    const audioBuffer = Buffer.from(data.Audio!, "base64");

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("TTS error:", e);
    return Response.json({ error: "语音合成失败" }, { status: 500 });
  }
}
