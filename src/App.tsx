import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Trash2, Radical } from "lucide-react";

/**
 * GPT Light Chat (Assistants API + SSE, Vercel AI Template–ready)
 * ----------------------------------------------------------------
 * Fixes in this revision:
 * - Adds required "OpenAI-Beta: assistants=v2" header to ALL requests
 * - Uses body `{ stream: true }` for the Run (prevents silent no-op)
 * - Robust SSE parsing for v2 events
 * - Forces LIGHT color-scheme; neutral disabled styles (no OS dark inheritance)
 * - Unifies button styles; centers icons; matches Send/Clear visuals
 * - Pretty light scrollbars for textarea and message pane
 */

// -------------- Types --------------

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: number;
};

// -------------- Helpers --------------

const qs = () => new URLSearchParams(window.location.search);

function getFromURL() {
  const p = qs();
  const assistantId =
    p.get("assistant_id") || p.get("assistantId") || p.get("assistant") || "";
  const apiKey = p.get("api_key") || p.get("apiKey") || "";
  return { assistantId, apiKey };
}

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function localKey(assistantId: string) {
  return `assistants:${assistantId}:threadId`;
}

function localMsgsKey(assistantId: string) {
  return `assistants:${assistantId}:cachedMessages`;
}

// Attempt to extract streamed text from a variety of assistant SSE payload shapes.
function extractDeltaText(data: any): string | null {
  try {
    // v2 Responses style
    if (
      data?.type === "response.output_text.delta" &&
      typeof data?.delta === "string"
    ) {
      return data.delta as string;
    }

    // v2 Assistants stream events
    if (data?.type === "thread.message.delta" && data?.delta?.content) {
      const parts = data.delta.content as any[];
      let out = "";
      for (const part of parts) {
        if (
          part?.type === "output_text_delta" &&
          typeof part?.text === "string"
        )
          out += part.text;
        if (part?.type === "text_delta" && typeof part?.text === "string")
          out += part.text;
        if (part?.type === "output_text" && part?.text?.value)
          out += part.text.value;
      }
      return out || null;
    }

    // Legacy-ish fallbacks
    if (data?.delta?.content?.[0]?.text?.value) {
      return data.delta.content[0].text.value as string;
    }
  } catch {}
  return null;
}

// Extract full message text from the Messages API response shape
function extractMessageText(msg: any): string {
  if (!msg?.content) return "";
  const parts = msg.content as any[];
  let out = "";
  for (const part of parts) {
    if (part.type === "text" && part.text?.value) out += part.text.value;
    if (part.type === "input_text" && part.text) out += String(part.text);
    if (part.type === "image_file") out += "\n![image](#)\n";
    if (part.type === "file_path")
      out += `\n[download file](${part.file_path?.file_id || "#"})\n`;
  }
  return out.trim();
}

// -------------- Component --------------

export default function GPTLightChat() {
  const { assistantId, apiKey } = useMemo(getFromURL, []);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Pre-baked classes for buttons so visuals are consistent
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm shadow-sm border transition active:scale-[.98] appearance-none leading-none";
  const btnPrimary =
    "bg-gradient-to-tr from-sky-400 via-fuchsia-400 to-pink-400 text-white border-transparent hover:opacity-95";
  const btnSecondary =
    "bg-rose-50 border-rose-200 text-slate-800 hover:bg-rose-100";
  const btnDisabled =
    "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  // Initialize thread (reuse from localStorage or create new)
  useEffect(() => {
    if (!assistantId || !apiKey) return;

    const existing = localStorage.getItem(localKey(assistantId));
    if (existing) {
      setThreadId(existing);
      // Load cached messages quickly (optimistic)
      const cached = localStorage.getItem(localMsgsKey(assistantId));
      if (cached) {
        try {
          setMessages(JSON.parse(cached));
        } catch {}
      }
      // Refresh from API
      void fetchMessages(existing, apiKey);
    } else {
      void createThread(apiKey)
        .then((id) => {
          setThreadId(id);
          localStorage.setItem(localKey(assistantId), id);
        })
        .catch((e) => setError(errMsg(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId, apiKey]);

  function commonHeadersJSON(key: string) {
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    } as const;
  }

  async function createThread(key: string): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: commonHeadersJSON(key),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.id as string;
  }

  async function fetchMessages(tid: string, key: string) {
    try {
      const res = await fetch(
        `https://api.openai.com/v1/threads/${tid}/messages?order=asc&limit=100`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "OpenAI-Beta": "assistants=v2",
          },
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const list: ChatMessage[] = (json.data || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: extractMessageText(m),
        createdAt: m.created_at ? m.created_at * 1000 : undefined,
      }));
      setMessages(list);
      localStorage.setItem(localMsgsKey(assistantId), JSON.stringify(list));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  function errMsg(e: unknown) {
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message;
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }

  async function sendMessage() {
    if (!input.trim() || !threadId || !assistantId || !apiKey) return;
    setIsSending(true);
    setError(null);

    const userText = input.trim();
    setInput("");

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userText,
      createdAt: Date.now(),
    };
    setMessages((m) => [
      ...m,
      userMsg,
      { id: "streaming", role: "assistant", content: "" },
    ]);

    try {
      // 1) Add user message to the thread
      const addMsg = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: commonHeadersJSON(apiKey),
          body: JSON.stringify({ role: "user", content: userText }),
        }
      );
      if (!addMsg.ok) throw new Error(await addMsg.text());

      // 2) Create a run with SSE streaming (v2 requires OpenAI-Beta header)
      const runRes = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs`,
        {
          method: "POST",
          headers: {
            ...commonHeadersJSON(apiKey),
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ assistant_id: assistantId, stream: true }),
        }
      );

      if (!runRes.ok || !runRes.body) {
        throw new Error(`Run failed: ${runRes.status} ${await runRes.text()}`);
      }

      const reader = runRes.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames end with two newlines; split and keep the carryover
        const frames = buf.split("\n\n");
        buf = frames.pop() || "";

        for (const frame of frames) {
          if (!frame.trim()) continue;

          // Each frame can include lines like: "event: ..." and "data: ..."
          const lines = frame.split("\n");
          const dataLines = lines
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.replace(/^data:\s?/, ""))
            .filter(Boolean);

          for (const dl of dataLines) {
            if (dl === "[DONE]") continue;
            let payload: any = null;
            try {
              payload = JSON.parse(dl);
            } catch {
              // Some servers may serialize JSON chunks across frames; ignore invalid
              continue;
            }

            // Update streaming message content
            const delta = extractDeltaText(payload);
            if (delta) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === "streaming"
                    ? { ...m, content: (m.content || "") + delta }
                    : m
                )
              );
            }

            // Completion signals: finalize and cache
            if (
              payload?.type === "thread.run.completed" ||
              payload?.event === "thread.run.completed" ||
              payload?.type === "response.completed" ||
              payload?.type === "thread.message.completed"
            ) {
              // Replace the temporary streaming id with a stable one
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === "streaming" ? { ...m, id: `asst-${Date.now()}` } : m
                )
              );
              // Refresh messages from API so we're exact
              void fetchMessages(threadId, apiKey);
            }

            // Error event
            if (payload?.type === "error" || payload?.error) {
              setError(payload?.error?.message || "Streaming error");
            }
          }
        }
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setIsSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  async function clearChat() {
    if (!assistantId) return;
    localStorage.removeItem(localKey(assistantId));
    localStorage.removeItem(localMsgsKey(assistantId));
    setMessages([]);
    setThreadId(null);
    setError(null);
    if (apiKey) {
      try {
        const id = await createThread(apiKey);
        setThreadId(id);
        localStorage.setItem(localKey(assistantId), id);
      } catch (e) {
        setError(errMsg(e));
      }
    }
  }

  const ready = Boolean(assistantId && apiKey && threadId);

  return (
    <div
      className="h-screen w-screen bg-gradient-to-b from-white via-rose-50 to-sky-50 text-slate-800 flex flex-col"
      style={{ colorScheme: "light" }}
    >
      {/* Light scrollbars for the app */}
      <style>{`
        .custom-scroll{ scrollbar-width: thin; scrollbar-color: #d1d5db #f8fafc; }
        .custom-scroll::-webkit-scrollbar{ height:10px; width:10px; }
        .custom-scroll::-webkit-scrollbar-thumb{ background:#d1d5db; border-radius:8px; border:2px solid #f8fafc; }
        .custom-scroll::-webkit-scrollbar-track{ background:#f8fafc; }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/60 backdrop-blur bg-white/70">
        <div className="mx-auto max-w-3xl w-full px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-tr from-pink-400 via-fuchsia-400 to-sky-400 grid place-items-center shadow-sm">
              <Radical className="h-5 w-5 text-white" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className={clsx(btnBase, btnSecondary)}
              title="Resetează conversația"
              style={{
                background: "#f9f9f9",
              }}
            >
              <Trash2 className="h-4 w-4" />
              Resetează
            </button>
          </div>
        </div>
      </header>

      {/* Status / Missing creds banner */}
      {(!assistantId || !apiKey) && (
        <div className="mx-auto max-w-3xl w-full px-4 pt-3">
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
            Provide <code>assistant_id</code> and <code>api_key</code> in the
            URL to begin.
            <div className="mt-1 text-xs text-amber-700/80">
              Example:{" "}
              <span className="font-mono">
                ?assistant_id=asst_123&api_key=sk-...
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Messages list */}
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scroll">
        <div className="mx-auto max-w-3xl w-full px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border bg-white p-6 shadow-sm"
            >
              <h2 className="font-semibold">Bine ai venit 👋</h2>
              <p className="mt-1 text-sm text-slate-600">
                Bla bla bla, bla bla bla, eu sunt Ilie.
              </p>
            </motion.div>
          )}

          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={clsx(
                "rounded-2xl px-4 py-3 shadow-sm border",
                m.role === "assistant"
                  ? "bg-white border-fuchsia-100"
                  : "bg-gradient-to-br from-sky-50 to-blue-50 border-sky-100"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={clsx(
                    "mt-0.5 h-7 w-7 shrink-0 rounded-xl grid place-items-center",
                    m.role === "assistant"
                      ? "bg-gradient-to-tr from-pink-400 via-fuchsia-400 to-sky-400"
                      : "bg-gradient-to-tr from-blue-400 to-sky-400"
                  )}
                >
                  <span className="text-xs text-white font-semibold">
                    {m.role === "assistant" ? "AI" : "You"}
                  </span>
                </div>

                <div className="min-w-0 prose prose-slate max-w-none prose-p:my-2 prose-pre:rounded-xl prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-code:before:content-[''] prose-code:after:content-[''] break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content || ""}
                  </ReactMarkdown>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 z-10 border-t border-white/60 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl w-full px-4 py-3">
          {error && (
            <div className="mb-2 text-sm rounded-xl border border-rose-300 bg-rose-50 p-2 text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={ready ? "Scrie un mesaj..." : "Te rog așteaptă..."}
              rows={1}
              className="flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:ring-4 focus:ring-fuchsia-200/60 shadow-sm placeholder:text-slate-400 appearance-none custom-scroll"
              style={{ maxHeight: 200 }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!ready || isSending || !input.trim()}
              className={clsx(
                btnBase,
                "h-11 w-12 p-0", // square button
                !ready || isSending || !input.trim() ? btnDisabled : btnPrimary
              )}
              style={
                !ready || isSending || !input.trim()
                  ? {
                      background: "#f9f9f9",
                      cursor: "not-allowed",
                      border: "none",
                    }
                  : {}
              }
              title="Trimite"
            >
              <div
                className="grid place-items-center h-5 w-5"
                style={{ marginLeft: -2 }}
              >
                <Send className="h-5 w-5" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
