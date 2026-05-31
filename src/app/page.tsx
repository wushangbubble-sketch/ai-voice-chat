"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type AppState = "idle" | "listening" | "processing" | "speaking";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [aiText, setAiText] = useState({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
  const [textKey, setTextKey] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef<string>("");

  // Safety timeout: if speaking state lasts >15s (e.g. mobile audio.onended didn't fire), reset to idle
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (appState === "speaking") {
      speakingTimerRef.current = setTimeout(() => {
        setAppState("idle");
        setAiText({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
        setTextKey((k) => k + 1);
      }, 15000);
    }
    return () => {
      if (speakingTimerRef.current) {
        clearTimeout(speakingTimerRef.current);
        speakingTimerRef.current = null;
      }
    };
  }, [appState]);

  const sendMessage = async (text: string) => {
    const t0 = performance.now();
    setAppState("processing");
    setAiText({ en: "...", zh: "..." });
    setTextKey((k) => k + 1);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      const tChat = performance.now();
      const chatTiming = data.timing as
        | { parse: number; deepseek: number }
        | undefined;
      console.log(
        `[Timing] /api/chat: ${Math.round(tChat - t0)}ms total` +
          (chatTiming
            ? ` (parse=${chatTiming.parse}ms, deepseek=${chatTiming.deepseek}ms)`
            : "")
      );

      setAiText({ en: data.reply_en, zh: data.reply_zh });
      setTextKey((k) => k + 1);
      setAppState("speaking");

      // Play TTS
      if (data.reply_en) {
        (async () => {
          try {
            const ttsRes = await fetch("/api/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: data.reply_en, speaker: "default" }),
            });
            const tTts = performance.now();
            console.log(
              `[Timing] /api/tts: ${Math.round(tTts - tChat)}ms` +
                ` | Server-Timing: ${ttsRes.headers.get("Server-Timing")}`
            );
            if (ttsRes.ok) {
              const blob = await ttsRes.blob();
              const url = URL.createObjectURL(blob);
              if (audioRef.current) {
                audioRef.current.onended = () => {
                  console.log(
                    `[Timing] Audio playback: ${Math.round(
                      performance.now() - tTts
                    )}ms`
                  );
                  console.log(
                    `[Timing] FULL CHAIN: ${Math.round(
                      performance.now() - t0
                    )}ms`
                  );
                  setAppState("idle");
                  setAiText({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
                  setTextKey((k) => k + 1);
                };
                audioRef.current.src = url;
                audioRef.current.play().catch(() => {
                  // Mobile browsers may reject play() after first use; reset to idle
                  setAppState("idle");
                  setAiText({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
                  setTextKey((k) => k + 1);
                });
              }
            }
          } catch {
            // TTS failed, return to idle after a delay
            setTimeout(() => {
              setAppState("idle");
              setAiText({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
              setTextKey((k) => k + 1);
            }, 3000);
          }
        })();
      } else {
        setAppState("idle");
      }
    } catch {
      setAiText({ en: "Connection failed. Please try again.", zh: "连接失败，请稍后重试" });
      setTextKey((k) => k + 1);
      setAppState("speaking");
      setTimeout(() => {
        setAppState("idle");
        setAiText({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
        setTextKey((k) => k + 1);
      }, 3000);
    }
  };

  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startListening = useCallback(async () => {
    cleanup();

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("语音输入需要 Chrome 浏览器");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e: any) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };

      const recognition = new SpeechRecognition();
      recognition.lang = "zh-CN";
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onstart = () => {
        setAppState("listening");
        setAiText({ en: "...", zh: "请讲话..." });
        setTextKey((k) => k + 1);
        mediaRecorder.start();
      };

      recognition.onend = () => {
        if (mediaRecorder.state === "recording") mediaRecorder.stop();

        const text = transcriptRef.current;
        transcriptRef.current = "";

        if (text.trim()) {
          sendMessage(text);
        } else {
          setAppState("idle");
          setAiText({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
          setTextKey((k) => k + 1);
        }
      };

      recognition.onerror = () => {
        if (mediaRecorder.state === "recording") mediaRecorder.stop();
        setAppState("idle");
        setAiText({ en: "Hi, I'm ready.", zh: "你好，我已经准备好了。" });
        setTextKey((k) => k + 1);
      };

      recognition.onresult = (e: any) => {
        // Accumulate all final results (continuous mode fires multiple results)
        let transcript = transcriptRef.current;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            transcript += e.results[i][0].transcript;
          }
        }
        transcriptRef.current = transcript;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      alert("无法访问麦克风");
      setAppState("idle");
    }
  }, []);

  const handleMicClick = () => {
    if (appState === "idle") {
      startListening();
    } else if (appState === "listening") {
      recognitionRef.current?.stop();
    }
  };

  const isButtonDisabled = appState === "processing" || appState === "speaking";

  const orbStateClass =
    appState === "idle"
      ? "state-idle"
      : appState === "listening"
        ? "state-listening"
        : "state-speaking";

  const statusText =
    appState === "idle"
      ? "AI Companion"
      : appState === "listening"
        ? "Listening..."
        : appState === "processing"
          ? "Processing..."
          : "Speaking";

  return (
    <>
      {/* Background */}
      <div className="fixed inset-0 z-0 overflow-hidden bg-[#2D452B]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#3A5D38] via-[#2D452B] to-[#1E3020] bg-pan" />
        <div className="absolute inset-0 bg-black/10" />
      </div>

      {/* Decorative glass elements */}
      <div className="fixed top-12 left-12 w-32 h-32 rounded-[2rem] glass-panel opacity-40 blur-[2px] hidden md:block" />
      <div className="fixed bottom-24 right-16 w-48 h-32 rounded-[2rem] glass-panel opacity-30 blur-[4px] hidden md:block" />

      {/* Main card */}
      <main className="relative z-10 w-full max-w-md h-dvh sm:h-[85vh] sm:max-h-[800px] sm:rounded-[2.5rem] glass-panel flex flex-col overflow-hidden shadow-2xl mx-auto sm:mt-[7.5vh]">
        {/* Header */}
        <header className="w-full px-6 py-6 flex items-center justify-between z-20 shrink-0">
          <div className="w-10 h-10" />
          <div className="flex flex-col items-center select-none">
            <span className="text-xs font-medium tracking-wider text-white/60 uppercase mb-0.5">
              Session
            </span>
            <span className="text-sm font-semibold tracking-wide text-white/90">
              {statusText}
            </span>
          </div>
          <div className="w-10 h-10" />
        </header>

        {/* Orb */}
        <div
          className={`flex-1 flex flex-col items-center justify-center relative z-10 ${orbStateClass}`}
        >
          <div className="orb-container">
            <div className="orb" />
          </div>
        </div>

        {/* Subtitle */}
        <div className="w-full px-8 pb-8 pt-4 min-h-[160px] flex flex-col justify-end items-center text-center z-20 shrink-0">
          <div key={textKey} className="w-full">
            <p className="text-xl md:text-2xl font-light text-white/90 leading-relaxed tracking-wide fade-in-up">
              {aiText.en}
            </p>
            <p
              className="text-sm md:text-base text-white/60 mt-3 font-normal tracking-widest fade-in-up"
              style={{ animationDelay: "0.15s" }}
            >
              {aiText.zh}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="w-full px-8 pb-10 pt-4 flex flex-col items-center z-20 shrink-0">
          <button
            onClick={handleMicClick}
            disabled={isButtonDisabled}
            className="w-16 h-16 rounded-full glass-button flex items-center justify-center group relative cursor-pointer outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div
              className={`absolute inset-0 rounded-full bg-emerald-400/30 scale-100 transition-all duration-300 ${
                appState === "listening" ? "opacity-100 animate-ping" : "opacity-0"
              }`}
            />
            {appState === "listening" ? (
              <svg
                className="w-6 h-6 text-white relative z-10"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg
                className="w-6 h-6 text-white group-hover:scale-110 transition-transform relative z-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
          <span className="text-xs text-white/40 mt-4 tracking-wide select-none">
            {appState === "idle" && "Tap to speak"}
            {appState === "listening" && "Listening..."}
            {appState === "processing" && "Processing..."}
            {appState === "speaking" && "AI is speaking..."}
          </span>
        </div>
      </main>

      <audio ref={audioRef} className="hidden" />
    </>
  );
}
