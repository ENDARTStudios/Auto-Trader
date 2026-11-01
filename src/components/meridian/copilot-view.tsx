"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "./api";
import { Icon } from "./icons";
import { Badge, Card } from "./ui";

interface Citation {
  entityType: string;
  entityId: string;
  score: number;
  content: string;
}

interface AskResponse {
  answer: string;
  citations: Citation[];
  context: string;
}

interface Message {
  id: string;
  role: "user" | "ai";
  text: string;
  citations?: Citation[];
}

const SUGGESTIONS = [
  "Por que a última posição foi aberta?",
  "Qual é o meu drawdown atual?",
  "Como o scam score bloqueia um token?",
  "Resuma as regras de risco da config",
];

export function CopilotView() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "ai",
      text:
        "Ask about a decision, a position or a risk rule. I answer from the indexed ledger and cite every source I used — I cannot place, close or resize orders.",
    },
  ]);
  const [question, setQuestion] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (q: string) => apiPost<AskResponse>("/api/ai/ask", { question: q }),
    onSuccess: (res, q) => {
      setMessages((m) => [
        ...m,
        { id: `u-${Date.now()}`, role: "user", text: q },
        { id: `a-${Date.now()}`, role: "ai", text: res.answer, citations: res.citations },
      ]);
      setQuestion("");
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
    },
    onError: (err: Error) => toast.error("Copilot unavailable", { description: err.message }),
  });

  const send = () => {
    const q = question.trim();
    if (q.length < 3) return;
    ask.mutate(q);
  };

  const lastCitations = [...messages].reverse().find((m) => m.citations?.length)?.citations ?? [];

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">AI Copilot</h1>
            <span className="mrd-status">
              <Badge tone="brand">grounded</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>answers cite the index</span>
            </span>
          </div>
          <p className="mrd-sub">
            Answers come from the RAG index over the ledger and config. This build uses a deterministic mock LLM — the
            citations are real even when the prose is not.
          </p>
        </div>
        <div className="mrd-actions">
          <button
            type="button"
            className="mrd-btn mrd-btn-ghost mrd-btn-sm"
            onClick={() => {
              setMessages((m) => m.slice(0, 1));
              toast.success("Thread cleared");
            }}
          >
            <Icon name="activity" size={15} /> New thread
          </button>
        </div>
      </header>

      <div className="mrd-hero">
        <section className="mrd-card mrd-chat">
          <div className="mrd-chat-scroll" ref={listRef}>
            {messages.map((m) => (
              <div className={`mrd-msg ${m.role}`} key={m.id}>
                <span className="mrd-av">{m.role === "ai" ? "AI" : "AD"}</span>
                <div>
                  <div className="mrd-bubble">{m.text}</div>
                  {m.citations?.length ? (
                    <div className="mrd-cites">
                      {m.citations.map((c, i) => (
                        <span className="mrd-cite" key={`${c.entityType}-${c.entityId}-${i}`}>
                          {c.entityType}:{c.entityId} · {c.score.toFixed(2)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {ask.isPending ? (
              <div className="mrd-msg ai">
                <span className="mrd-av">AI</span>
                <div className="mrd-bubble">Consultando o índice…</div>
              </div>
            ) : null}
          </div>
          <div className="mrd-compose">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about a decision, a position or a rule…"
              aria-label="Question"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="button" className="mrd-btn mrd-btn-primary" onClick={send} disabled={ask.isPending || question.trim().length < 3}>
              <Icon name="up" size={15} /> Send
            </button>
          </div>
          <div className="mrd-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="mrd-chip" onClick={() => setQuestion(s)}>
                {s}
              </button>
            ))}
          </div>
        </section>

        <div className="mrd-side">
          <Card title="Evidence used" sub={lastCitations.length ? `last answer · ${lastCitations.length} sources` : "no answer yet"}>
            {lastCitations.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {lastCitations.map((c, i) => (
                  <div key={`${c.entityId}-${i}`} style={{ display: "grid", gap: 3 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                      <b style={{ fontSize: 12 }}>{c.entityType}</b>
                      <span className="mrd-dim">{c.score.toFixed(2)}</span>
                    </div>
                    <p className="mrd-dim" style={{ fontSize: 11.5, lineHeight: 1.45 }}>{c.content.slice(0, 160)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>Send a question — the sources it retrieved appear here.</p>
            )}
          </Card>

          <div className="mrd-banner" data-tone="info">
            <Icon name="risk" size={16} />
            <div className="grow">Copilot is advisory. It cannot place, close or resize orders.</div>
          </div>
        </div>
      </div>
    </>
  );
}
