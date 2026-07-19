"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function InlineMarkdown({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-extrabold text-[#F5F7FA]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="space-y-2">
      {content.split("\n").map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={index} className="h-1" />;

        const heading = line.match(/^#{1,3}\s+(.+)$/);
        if (heading) {
          return (
            <p key={index} className="pt-1 font-extrabold text-[#F5F7FA]">
              <InlineMarkdown text={heading[1]} />
            </p>
          );
        }

        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={index} className="flex gap-2">
              <span aria-hidden className="mt-[0.05rem] text-[#9B8AFB]">•</span>
              <p className="min-w-0"><InlineMarkdown text={bullet[1]} /></p>
            </div>
          );
        }

        return <p key={index}><InlineMarkdown text={line} /></p>;
      })}
    </div>
  );
}

const SUGGESTIONS = [
  "What exercises did I do last session?",
  "How has my squat progressed?",
  "Which coaching cues keep coming up?",
  "What should I focus on next session?",
];

function AskAIContent() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setMessages((previous) => [...previous, { role: "user", content: question }]);
    setLoading(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sessionId, history: messages }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: data.answer ?? "No answer returned." },
      ]);
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: `I couldn’t reach your training history (${(error as Error).message}). Please try again.` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  const sessionId = searchParams.get("session");

  function startNewChat() {
    if (loading) return;
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-9.5rem)] min-h-[34rem] max-w-4xl flex-col">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Training intelligence</p>
          <h1 className="page-title mt-2 text-4xl font-black text-[#F5F7FA] sm:text-5xl">Ask Trainwell</h1>
          <p className="mt-3 text-sm text-[#9CA7B8]">Explore patterns, coaching cues, and progress across your own workout history.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessionId && (
            <div className="w-fit rounded-full border border-[#9B8AFB]/20 bg-[#211C3A]/60 px-3 py-2 text-[0.65rem] font-black tracking-wide text-[#9B8AFB]">
              SESSION {sessionId.slice(0, 8).toUpperCase()}…
            </div>
          )}
          <button
            onClick={startNewChat}
            disabled={loading || messages.length === 0}
            className="rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-[0.65rem] font-black tracking-wide text-[#9CA7B8] transition hover:border-[#C7F36B]/30 hover:text-[#C7F36B] disabled:cursor-not-allowed disabled:opacity-35"
          >
            NEW CHAT
          </button>
        </div>
      </header>

      <section className="portal-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px]">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-3.5">
          <span className="size-2 rounded-full bg-[#79D99B] shadow-[0_0_12px_rgba(121,217,155,0.5)]" />
          <span className="text-[0.64rem] font-black uppercase tracking-[0.15em] text-[#667085]">Connected to your workout history</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.length === 0 && !loading && (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center text-center">
              <div className="flex size-14 items-center justify-center rounded-[20px] border border-[#9B8AFB]/15 bg-[#211C3A]/60 text-2xl text-[#9B8AFB]">✦</div>
              <h2 className="mt-5 text-xl font-black tracking-[-0.03em]">What do you want to know?</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#667085]">Ask a question or start with one of these prompts.</p>
              <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((question) => (
                  <button
                    key={question}
                    onClick={() => {
                      setInput(question);
                      inputRef.current?.focus();
                    }}
                    className="rounded-2xl border border-white/[0.07] bg-white/[0.035] px-4 py-3 text-left text-xs font-semibold leading-5 text-[#9CA7B8] transition hover:-translate-y-0.5 hover:border-[#C7F36B]/25 hover:text-[#F5F7FA]"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap sm:max-w-[78%] ${
                  message.role === "user"
                    ? "rounded-br-sm bg-[#C7F36B] font-medium text-[#101707]"
                    : "rounded-bl-sm border border-white/[0.07] bg-[#202736] text-[#D9DEE7]"
                }`}>
                  {message.role === "assistant"
                    ? <AssistantMessage content={message.content} />
                    : message.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm border border-white/[0.07] bg-[#202736] px-4 py-3">
                  <span className="flex gap-1.5">
                    {[0, 150, 300].map((delay) => (
                      <span key={delay} className="size-1.5 animate-bounce rounded-full bg-[#9B8AFB]" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/[0.07] bg-[#070A11]/35 p-3 sm:p-4">
          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.09] bg-[#101520] p-2 transition-colors focus-within:border-[#C7F36B]/35">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask anything about your workouts…"
              rows={1}
              className="max-h-[120px] min-h-10 flex-1 resize-none overflow-hidden bg-transparent px-2 py-2 text-sm text-[#F5F7FA] outline-none placeholder:text-[#667085]"
              onInput={(event) => {
                const element = event.currentTarget;
                element.style.height = "auto";
                element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
              }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              aria-label="Send question"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#C7F36B] text-[#101707] transition hover:bg-[#D3FA80] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <span className="text-lg font-black">↑</span>
            </button>
          </div>
          <p className="mt-2 text-center text-[0.62rem] text-[#4D5667]">Answers are grounded in your recorded training history.</p>
        </div>
      </section>
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense>
      <AskAIContent />
    </Suspense>
  );
}
