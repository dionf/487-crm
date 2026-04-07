"use client";

import { useState } from "react";
import { X, Sparkles, Send, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function EmailCompose({ open, onClose, quoteId, defaultTo, onSent }) {
  const [to, setTo] = useState(defaultTo || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const res = await apiFetch(`/api/quotes/${quoteId}/generate-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSubject(data.subject || "");
      setBodyHtml(data.body_html || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    if (!to || !subject || !bodyHtml) {
      setError("Vul alle velden in");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await apiFetch(`/api/quotes/${quoteId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, cc: cc || null, subject, body_html: bodyHtml }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSent(true);
      onSent?.();
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-lg">Offerte mailen</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {sent ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-lg font-semibold text-green-700">E-mail verzonden!</p>
          </div>
        ) : (
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Aan *</label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  placeholder="email@voorbeeld.nl"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">CC</label>
                <input
                  type="email"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  placeholder="optioneel"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Onderwerp *</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                placeholder="Offerte..."
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  E-mailtekst *
                </label>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-pill bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-40"
                >
                  {generating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  AI genereren
                </button>
              </div>
              <textarea
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={10}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber resize-none font-mono"
                placeholder="<p>Beste ...</p>"
              />
            </div>

            {/* Preview */}
            {bodyHtml && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Preview</label>
                <div
                  className="mt-1 p-4 bg-gray-50 rounded-xl text-sm border border-gray-100 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Annuleren
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !to || !subject || !bodyHtml}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Versturen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
