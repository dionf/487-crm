"use client";

import { useState, useEffect, useRef } from "react";
import { X, Sparkles, Send, Loader2, CheckCircle2, AlertTriangle, Bot, User, Trash2, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * AI offerte-advies modal.
 * Props:
 *   - open: boolean
 *   - onClose: () => void
 *   - formSubmissionId?: string  (bij openen vanuit inbox)
 *   - leadId?: string            (bij openen vanuit lead detail — endpoint zoekt zelf de recentste chatbot-submission)
 *   - onCommitted: ({ quote_id, quote_number, lead_id }) => void
 */
export default function AIQuoteAdvisor({ open, onClose, formSubmissionId, leadId, onCommitted }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chatLog, setChatLog] = useState([]); // [{ from: 'ai'|'you', text }]
  const [history, setHistory] = useState([]); // Claude messages (opaque)
  const [quoteState, setQuoteState] = useState(null);
  const [resolvedFormSubmissionId, setResolvedFormSubmissionId] = useState(null);
  const [resolvedLeadId, setResolvedLeadId] = useState(null);
  const [input, setInput] = useState("");
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(null); // { quote_id, quote_number }

  const chatEndRef = useRef(null);

  // Reset + initiële generate bij openen
  useEffect(() => {
    if (!open) return;
    setChatLog([]);
    setHistory([]);
    setQuoteState(null);
    setError("");
    setCommitted(null);
    setInput("");
    setResolvedFormSubmissionId(null);
    setResolvedLeadId(null);
    fetchAdvice({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formSubmissionId, leadId]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatLog, loading]);

  async function fetchAdvice({ initial = false, userMessage = null } = {}) {
    setLoading(true);
    setError("");
    try {
      const body = {
        form_submission_id: formSubmissionId || resolvedFormSubmissionId,
        lead_id: leadId || resolvedLeadId,
        history: initial ? [] : history,
        message: initial ? null : userMessage,
      };
      const res = await apiFetch("/api/hiphot/ai-quote-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "AI advies mislukt");
        if (initial && userMessage == null) {
          // Geef mislukking ook in chat weer
          setChatLog((prev) => [...prev, { from: "ai", text: `⚠️ ${data.error || "Er ging iets mis"}${data.raw ? `\n\n${data.raw}` : ""}` }]);
        }
        return;
      }
      setHistory(data.history || []);
      setQuoteState(data.quote_state);
      if (data.form_submission_id) setResolvedFormSubmissionId(data.form_submission_id);
      if (data.lead_id) setResolvedLeadId(data.lead_id);
      setChatLog((prev) => [...prev, { from: "ai", text: data.ai_message || "(geen toelichting)" }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setChatLog((prev) => [...prev, { from: "you", text }]);
    setInput("");
    fetchAdvice({ userMessage: text });
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleCommit() {
    if (committing || !quoteState) return;
    const targetLeadId = leadId || resolvedLeadId;
    if (!targetLeadId) {
      setError("Geen lead gekoppeld");
      return;
    }
    setCommitting(true);
    setError("");
    try {
      const res = await apiFetch("/api/hiphot/ai-quote-advice/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: targetLeadId,
          form_submission_id: formSubmissionId || resolvedFormSubmissionId,
          quote_state: quoteState,
          chat_log: chatLog,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Kon offerte niet aanmaken");
        return;
      }
      setCommitted({ quote_id: data.quote_id, quote_number: data.quote_number, lead_id: targetLeadId });
      onCommitted?.({ quote_id: data.quote_id, quote_number: data.quote_number, lead_id: targetLeadId });
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  }

  if (!open) return null;

  const { subtotaalBruto, discountAmount, nettoVerkoop, totaalExcl, btw, totaalIncl } = calculateTotals(quoteState);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !committing && !loading && onClose()}>
      <div
        className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand-amber" />
            <h2 className="font-semibold text-lg">AI offerte-advies</h2>
          </div>
          <button
            onClick={() => !committing && onClose()}
            disabled={committing}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {committed ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-500 mb-4" />
            <h3 className="font-semibold text-xl text-brand-black mb-2">
              Offerte {committed.quote_number} aangemaakt
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              Concept-offerte is opgeslagen op de klantkaart. Je kunt &lsquo;m nu verder bewerken of publiceren.
            </p>
            <button
              onClick={() => {
                onClose();
                if (typeof window !== "undefined") {
                  window.location.href = `/leads/${committed.lead_id}`;
                }
              }}
              className="px-6 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black"
            >
              Naar klantkaart →
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Main content: quote panel (boven) + chat (onder) */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50">
              {/* Current quote */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-brand-black">Huidige offerte</h3>
                  {quoteState && (
                    <span className="text-xs text-gray-400">
                      {quoteState.line_items?.length || 0} regel{quoteState.line_items?.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                {!quoteState && loading && (
                  <div className="py-10 flex flex-col items-center gap-3 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <p className="text-sm">AI denkt na...</p>
                  </div>
                )}

                {quoteState && (
                  <>
                    <div className="border border-gray-100 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-xs text-gray-500">SKU</th>
                            <th className="text-left px-3 py-2 font-medium text-xs text-gray-500">Product</th>
                            <th className="text-right px-3 py-2 font-medium text-xs text-gray-500 w-16">Aantal</th>
                            <th className="text-right px-3 py-2 font-medium text-xs text-gray-500 w-24">Prijs</th>
                            <th className="text-right px-3 py-2 font-medium text-xs text-gray-500 w-24">Totaal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quoteState.line_items.map((item, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2 text-xs text-gray-500 font-mono">{item.sku || "—"}</td>
                              <td className="px-3 py-2 text-gray-700">{item.name}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{item.quantity}</td>
                              <td className="px-3 py-2 text-right text-gray-700">€{Number(item.unit_price).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-gray-700 font-medium">
                                €{(Number(item.unit_price) * Number(item.quantity)).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-gray-50 border-t border-gray-200">
                            <td className="px-3 py-2 text-gray-600" colSpan={4}>Subtotaal</td>
                            <td className="px-3 py-2 text-right text-gray-800 font-medium">€{subtotaalBruto.toFixed(2)}</td>
                          </tr>
                          {quoteState.discount_pct > 0 && (
                            <tr className="bg-gray-50 border-t border-gray-200">
                              <td className="px-3 py-2 text-gray-600" colSpan={4}>Korting {quoteState.discount_pct}%</td>
                              <td className="px-3 py-2 text-right text-gray-800 font-medium">− €{discountAmount.toFixed(2)}</td>
                            </tr>
                          )}
                          {quoteState.shipping_cost > 0 && (
                            <tr className="bg-gray-50 border-t border-gray-200">
                              <td className="px-3 py-2 text-gray-600" colSpan={4}>Verzending</td>
                              <td className="px-3 py-2 text-right text-gray-800 font-medium">€{Number(quoteState.shipping_cost).toFixed(2)}</td>
                            </tr>
                          )}
                          <tr className="bg-gray-50 border-t border-gray-200">
                            <td className="px-3 py-2 text-gray-600" colSpan={4}>Totaal excl. BTW</td>
                            <td className="px-3 py-2 text-right text-gray-900 font-semibold">€{totaalExcl.toFixed(2)}</td>
                          </tr>
                          <tr className="bg-gray-50 border-t border-gray-200">
                            <td className="px-3 py-2 text-gray-500 text-xs" colSpan={4}>BTW 21%</td>
                            <td className="px-3 py-2 text-right text-gray-500 text-xs">€{btw.toFixed(2)}</td>
                          </tr>
                          <tr className="bg-brand-amber/10 border-t border-gray-200">
                            <td className="px-3 py-2 text-gray-700 font-semibold" colSpan={4}>Totaal incl. BTW</td>
                            <td className="px-3 py-2 text-right text-brand-black font-bold">€{totaalIncl.toFixed(2)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {quoteState.rationale && (
                      <div className="mt-3 bg-amber-50 border border-amber-100 rounded-xl p-3">
                        <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">
                          Onderbouwing
                        </p>
                        <p className="text-xs text-amber-900 leading-relaxed">{quoteState.rationale}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Chat log */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h3 className="font-semibold text-sm text-brand-black mb-3">Gesprek met AI</h3>
                <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                  {chatLog.length === 0 && !loading && (
                    <p className="text-xs text-gray-400 italic">Nog geen bericht.</p>
                  )}
                  {chatLog.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex gap-2 ${msg.from === "you" ? "justify-end" : ""}`}
                    >
                      {msg.from === "ai" && (
                        <div className="w-7 h-7 rounded-full bg-brand-amber/20 flex items-center justify-center flex-shrink-0">
                          <Bot className="w-3.5 h-3.5 text-brand-amber" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                          msg.from === "you"
                            ? "bg-brand-black text-white rounded-br-sm"
                            : "bg-gray-100 text-gray-700 rounded-bl-sm"
                        }`}
                      >
                        {msg.text}
                      </div>
                      {msg.from === "you" && (
                        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5 text-gray-600" />
                        </div>
                      )}
                    </div>
                  ))}
                  {loading && (
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-amber/20 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3.5 h-3.5 text-brand-amber" />
                      </div>
                      <div className="bg-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm">
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            {/* Chat input */}
            <div className="border-t border-gray-100 p-4 flex-shrink-0">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading || committing}
                  placeholder="Bijv. haal drip tray eruit, voeg 10% korting toe, verander aantal dispensers naar 3..."
                  rows={1}
                  className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber resize-none disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={loading || committing || !input.trim()}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  Verstuur
                </button>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex gap-3 p-4 border-t border-gray-100 flex-shrink-0">
              <button
                onClick={onClose}
                disabled={committing}
                className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuleren
              </button>
              <button
                onClick={handleCommit}
                disabled={committing || loading || !quoteState || !quoteState.line_items?.length}
                className="flex-1 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {committing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Aanmaken...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Maak concept-offerte
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function calculateTotals(quote) {
  if (!quote || !Array.isArray(quote.line_items)) {
    return { subtotaalBruto: 0, discountAmount: 0, nettoVerkoop: 0, totaalExcl: 0, btw: 0, totaalIncl: 0 };
  }
  const subtotaalBruto = quote.line_items.reduce(
    (sum, i) => sum + Number(i.unit_price || 0) * Number(i.quantity || 0),
    0
  );
  const discountPct = Number(quote.discount_pct) || 0;
  const discountAmount = Number((subtotaalBruto * (discountPct / 100)).toFixed(2));
  const nettoVerkoop = Number((subtotaalBruto - discountAmount).toFixed(2));
  const shipping = Number(quote.shipping_cost) || 0;
  const totaalExcl = Number((nettoVerkoop + shipping).toFixed(2));
  const btw = Number((totaalExcl * 0.21).toFixed(2));
  const totaalIncl = Number((totaalExcl + btw).toFixed(2));
  return { subtotaalBruto, discountAmount, nettoVerkoop, totaalExcl, btw, totaalIncl };
}
