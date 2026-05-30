"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Message = {
  role: "user" | "ai";
  content: string;
};

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 语音识别
  const startRecording = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("你的浏览器不支持语音输入，请使用 Chrome");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => setRecording(true);
    recognition.onend = () => setRecording(false);
    recognition.onerror = () => setRecording(false);
    recognition.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setInput((prev) => prev + text);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setRecording(false);
  }, []);

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
      });
      const data = await res.json();
      const aiMsg: Message = { role: "ai", content: data.reply };
      setMessages((prev) => [...prev, aiMsg]);

      if (ttsReady) {
        playTTS(data.reply);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: "连接失败，请稍后重试" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const playTTS = async (text: string) => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, speaker: "default" }),
      });
      if (!res.ok) throw new Error("TTS 未就绪");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
      }
    } catch {
      console.log("TTS 暂不可用");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <span className="brand-dot" />
          <div>
            <h1 className="header-title">英文语伴</h1>
            <p className="header-subtitle">你说中文，AI 用英文回复你</p>
          </div>
        </div>
        <div className="header-right">
          <span className={`status-dot ${ttsReady ? "active" : ""}`} />
          <span className="status-label">{ttsReady ? "语音就绪" : "文本模式"}</span>
        </div>
      </header>

      {/* Messages */}
      <div className="chat-area">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎧</div>
            <p className="empty-title">开始你的英语练习</p>
            <p className="empty-desc">
              输入或说出中文，AI 会用地道英语回复你
            </p>
          </div>
        ) : (
          <div className="messages-container">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`message-row ${msg.role === "user" ? "user" : "ai"}`}
              >
                <div className="bubble">
                  <p>{msg.content}</p>
                  {msg.role === "ai" && (
                    <button
                      onClick={() => playTTS(msg.content)}
                      className="play-btn"
                    >
                      播放语音
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="message-row ai">
                <div className="bubble loading-bubble">
                  <span className="dot-pulse" />
                  <span className="dot-pulse" />
                  <span className="dot-pulse" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="input-area">
        <div className="input-bar">
          <button
            onClick={toggleRecording}
            className={`mic-btn ${recording ? "recording" : ""}`}
            title={recording ? "停止录音" : "语音输入"}
          >
            {recording ? "⏹" : "🎤"}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入中文，和 AI 英文聊天..."
            rows={1}
            className="input-field"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="send-btn"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
        <p className="input-hint">
          Enter 发送 · Shift+Enter 换行
          {recording && <span className="recording-hint"> · 录音中...</span>}
        </p>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
