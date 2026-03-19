"use client";

import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, Loader2, X } from "lucide-react";

export default function CoworkBar({ onResult }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keyboard shortcut: Cmd+K
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch("/api/cowork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: userMessage }),
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.message || "Klaar!", data },
      ]);

      if (onResult) onResult(data);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Er ging iets mis. Probeer opnieuw." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-brand-black rounded-2xl shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-50"
        title="Cowork (Cmd+K)"
      >
        <MessageSquare className="w-6 h-6 text-brand-amber" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[480px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-brand-black rounded-lg flex items-center justify-center">
            <span className="text-brand-amber text-[10px] font-bold">48</span>
          </div>
          <span className="font-semibold text-sm">Cowork</span>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            Cmd+K
          </span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-xs text-gray-400 mt-8">
            <p className="font-medium mb-2">Probeer:</p>
            <div className="space-y-1">
              <p>&quot;toon leads&quot;</p>
              <p>&quot;nieuwe lead TechBV&quot;</p>
              <p>&quot;status Enablemi naar gewonnen&quot;</p>
              <p>&quot;rapportage&quot;</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                msg.role === "user"
                  ? "bg-brand-amber/20 text-brand-black"
                  : "bg-gray-100 text-brand-dark-gray"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-3 py-2 rounded-2xl">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Typ een commando..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-1.5 rounded-lg bg-brand-amber hover:bg-brand-amber-hover disabled:opacity-30 transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-brand-black" />
          </button>
        </div>
      </form>
    </div>
  );
}
