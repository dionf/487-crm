"use client";

import { useState, useEffect, useRef } from "react";
import { X, Sparkles, Send, Loader2, CheckCircle2, AlertTriangle, Bot, User, Trash2, Plus, ChevronDown, ChevronRight, FileText, MessageSquare, Mail, Info, RefreshCw } from "lucide-react";
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
  const [resolvedLeadId, setResolvedLeadId] = useState(null);
  const [input, setInput] = useState("");
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(null);
  const [learnChecked, setLearnChecked] = useState(false);

  // Context-panel
  const [context, setContext] = useState(null); // { lead, notes, submissions, default_selection }
  const [selectedNoteIds, setSelectedNoteIds] = useState(new Set());
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState(new Set());
  const [contextOpen, setContextOpen] = useState(true);
  const [contextDirty, setContextDirty] = useState(false); // true wanneer selectie gewijzigd maar nog niet herregenereerd
  const [contextSummary, setContextSummary] = useState(null); // welke items heeft AI meegekregen (voetnoot)

  const initialQuoteRef = useRef(null);
  const refinementCountRef = useRef(0);
  const chatEndRef = useRef(null);

  // Reset + initiële flow bij openen: eerst context, dan advies
  useEffect(() => {
    if (!open) return;
    setChatLog([]);
    setHistory([]);
    setQuoteState(null);
    setError("");
    setCommitted(null);
    setInput("");
    setResolvedLeadId(null);
    setLearnChecked(false);
    setContext(null);
    setSelectedNoteIds(new Set());
    setSelectedSubmissionIds(new Set());
    setContextOpen(true);
    setContextDirty(false);
    setContextSummary(null);
    initialQuoteRef.current = null;
    refinementCountRef.current = 0;
    loadContextAndAdvice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, formSubmissionId, leadId]);

  async function resolveLeadId() {
    if (leadId) return leadId;
    if (formSubmissionId) {
      // Zoek lead via form_submission
      try {
        const res = await apiFetch(`/api/inbox/${formSubmissionId}`);
        if (res.ok) {
          const d = await res.json();
          return d.submission?.lead_id || null;
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  async function loadContextAndAdvice() {
    setLoading(true);
    setError("");
    try {
      const target = await resolveLeadId();
      if (!target) {
        setError("Kon lead niet bepalen");
        return;
      }
      setResolvedLeadId(target);
      // 1. Haal context op
      const ctxRes = await apiFetch(`/api/hiphot/ai-quote-advice/context?lead_id=${target}`);
      const ctxData = await ctxRes.json();
      if (!ctxRes.ok) {
        setError(ctxData.error || "Kon context niet laden");
        return;
      }
      setContext(ctxData);
      const defaultNotes = new Set(ctxData.default_selection?.note_ids || []);
      const defaultSubs = new Set(ctxData.default_selection?.submission_ids || []);
      setSelectedNoteIds(defaultNotes);
      setSelectedSubmissionIds(defaultSubs);
      setContextOpen(defaultNotes.size + defaultSubs.size > 0 ? false : true);
      // 2. Genereer initieel advies met die selectie
      await fetchAdvice({
        initial: true,
        noteIds: [...defaultNotes],
        submissionIds: [...defaultSubs],
        targetLeadId: target,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatLog, loading]);

  async function fetchAdvice({ initial = false, userMessage = null, noteIds, submissionIds, targetLeadId } = {}) {
    setLoading(true);
    setError("");
    try {
      const useLeadId = targetLeadId || leadId || resolvedLeadId;
      const useNoteIds = Array.isArray(noteIds) ? noteIds : [...selectedNoteIds];
      const useSubIds = Array.isArray(submissionIds) ? submissionIds : [...selectedSubmissionIds];
      const body = {
        lead_id: useLeadId,
        history: initial ? [] : history,
        message: initial ? null : userMessage,
        quote_state: initial ? null : quoteState,
        selected_note_ids: useNoteIds,
        selected_submission_ids: useSubIds,
      };
      const res = await apiFetch("/api/hiphot/ai-quote-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "AI advies mislukt");
        if (initial) {
          setChatLog((prev) => [...prev, { from: "ai", text: `⚠️ ${data.error || "Er ging iets mis"}${data.raw ? `\n\n${data.raw}` : ""}` }]);
        }
        return;
      }
      setHistory(data.history || []);
      setQuoteState(data.quote_state);
      if (data.lead_id) setResolvedLeadId(data.lead_id);
      if (data.context_summary) setContextSummary(data.context_summary);
      setContextDirty(false);
      setChatLog((prev) => [...prev, { from: "ai", text: data.ai_message || "(geen toelichting)" }]);

      if (initial && !initialQuoteRef.current) {
        initialQuoteRef.current = data.quote_state;
      }
      if (userMessage && !data.quote_unchanged) {
        refinementCountRef.current += 1;
        setLearnChecked(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleNote(id) {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setContextDirty(true);
  }

  function toggleSubmission(id) {
    setSelectedSubmissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setContextDirty(true);
  }

  async function regenerateWithCurrentSelection() {
    // Reset gesprek + advies, verse initial-call met nieuwe selectie
    setChatLog([]);
    setHistory([]);
    setQuoteState(null);
    initialQuoteRef.current = null;
    refinementCountRef.current = 0;
    setLearnChecked(false);
    await fetchAdvice({ initial: true });
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
          form_submission_id: formSubmissionId,
          quote_state: quoteState,
          chat_log: chatLog,
          initial_quote_state: initialQuoteRef.current,
          learn: learnChecked,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Kon offerte niet aanmaken");
        return;
      }
      setCommitted({
        quote_id: data.quote_id,
        quote_number: data.quote_number,
        lead_id: targetLeadId,
        lessons_created: data.lessons_created || 0,
        lessons_merged: data.lessons_merged || 0,
        extract_error: data.extract_error || null,
      });
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
            <p className="text-sm text-gray-500 mb-3">
              Concept-offerte is opgeslagen op de klantkaart. Je kunt &lsquo;m nu verder bewerken of publiceren.
            </p>
            {(committed.lessons_created > 0 || committed.lessons_merged > 0) && (
              <p className="text-xs text-brand-amber mb-3 flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                {committed.lessons_created > 0 && `${committed.lessons_created} nieuwe regel${committed.lessons_created === 1 ? "" : "s"} geleerd`}
                {committed.lessons_created > 0 && committed.lessons_merged > 0 && " · "}
                {committed.lessons_merged > 0 && `${committed.lessons_merged} bestaande bevestigd`}
              </p>
            )}
            {committed.extract_error && (
              <p className="text-xs text-red-500 mb-3">
                ⚠️ Kon lessen niet opslaan: {committed.extract_error}
              </p>
            )}
            <div className="mb-3" />
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
            {/* Main content: context (boven) + quote (midden) + chat (onder) */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50">
              {/* Context selection */}
              {context && (
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => setContextOpen(!contextOpen)}
                    className="w-full flex items-center gap-2 px-5 py-3 hover:bg-gray-50/50 transition-colors"
                  >
                    {contextOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <Info className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-semibold text-brand-black">Context meenemen</span>
                    <span className="ml-auto text-xs text-gray-400">
                      {selectedNoteIds.size + selectedSubmissionIds.size} geselecteerd
                    </span>
                    {contextDirty && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-amber-100 text-amber-700 ml-2">
                        Gewijzigd
                      </span>
                    )}
                  </button>
                  {contextOpen && (
                    <div className="px-5 pb-4 space-y-3">
                      <p className="text-xs text-gray-500">
                        Alleen de aangevinkte items worden meegegeven aan de AI. Vink oude of irrelevante zaken uit.
                        {context.last_quote_at && (
                          <span className="ml-1 text-gray-400">
                            Default: alles na offerte {new Date(context.last_quote_at).toLocaleDateString("nl-NL")}.
                          </span>
                        )}
                      </p>

                      {context.submissions && context.submissions.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                            Aanvragen / formulieren ({context.submissions.length})
                          </p>
                          <div className="space-y-1">
                            {context.submissions.map((s) => {
                              const checked = selectedSubmissionIds.has(s.id);
                              const Icon = s.source === "chatbot" ? Bot : s.source === "email" ? Mail : FileText;
                              return (
                                <label key={s.id} className="flex items-start gap-2 p-2 rounded-xl hover:bg-gray-50 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleSubmission(s.id)}
                                    className="mt-0.5 rounded border-gray-300 accent-brand-amber"
                                  />
                                  <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${s.source === "chatbot" ? "text-brand-amber" : s.source === "email" ? "text-blue-500" : "text-gray-500"}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="font-semibold capitalize">{s.source || "form"}</span>
                                      <span className="text-gray-400">{new Date(s.created_at).toLocaleDateString("nl-NL")}</span>
                                      {s.contact && <span className="text-gray-500 truncate">· {s.contact}</span>}
                                      {s.has_structured_data && (
                                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-pill bg-amber-50 text-amber-700">gestructureerd</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500 truncate">{s.message_preview || "(geen preview)"}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {context.notes && context.notes.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                            Notities ({context.notes.length})
                          </p>
                          <div className="space-y-1">
                            {context.notes.map((n) => {
                              const checked = selectedNoteIds.has(n.id);
                              return (
                                <label key={n.id} className="flex items-start gap-2 p-2 rounded-xl hover:bg-gray-50 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleNote(n.id)}
                                    className="mt-0.5 rounded border-gray-300 accent-brand-amber"
                                  />
                                  <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="font-semibold capitalize">{n.note_type || "notitie"}</span>
                                      <span className="text-gray-400">{new Date(n.created_at).toLocaleDateString("nl-NL")}</span>
                                      {n.created_by && <span className="text-gray-500 truncate">· {n.created_by}</span>}
                                    </div>
                                    <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">{n.content_preview || "(leeg)"}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {(context.notes.length === 0 && context.submissions.length === 0) && (
                        <p className="text-xs text-gray-400 italic">Geen notities of aanvragen op deze lead.</p>
                      )}

                      {contextDirty && (
                        <div className="pt-2 border-t border-gray-100">
                          <button
                            onClick={regenerateWithCurrentSelection}
                            disabled={loading}
                            className="px-3 py-1.5 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                            Advies opnieuw genereren met nieuwe selectie
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

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

                    {/* Rapportage-voetnoot: welke context is meegenomen */}
                    {contextSummary && (contextSummary.notes.length + contextSummary.submissions.length > 0) && (
                      <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
                        <Info className="inline-block w-3 h-3 mr-1 -mt-0.5" />
                        Advies op basis van:{" "}
                        {[
                          ...contextSummary.submissions.map((s) => `${s.source || "form"} ${new Date(s.created_at).toLocaleDateString("nl-NL")}`),
                          ...contextSummary.notes.map((n) => `${n.note_type || "notitie"} ${new Date(n.created_at).toLocaleDateString("nl-NL")}`),
                        ].join(", ")}
                        {context && (
                          (() => {
                            const skippedNotes = (context.notes?.length || 0) - contextSummary.notes.length;
                            const skippedSubs = (context.submissions?.length || 0) - contextSummary.submissions.length;
                            const skipped = skippedNotes + skippedSubs;
                            return skipped > 0 ? ` · ${skipped} item${skipped === 1 ? "" : "s"} overgeslagen (vink aan in Context als je die mee wilt nemen)` : "";
                          })()
                        )}
                      </p>
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

            {/* Learn checkbox — alleen zinvol als er refinements zijn gedaan */}
            {refinementCountRef.current > 0 && (
              <div className="px-4 pt-3 flex-shrink-0">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 select-none">
                  <input
                    type="checkbox"
                    checked={learnChecked}
                    onChange={(e) => setLearnChecked(e.target.checked)}
                    disabled={committing}
                    className="rounded border-gray-300 accent-brand-amber"
                  />
                  <Sparkles className="w-3.5 h-3.5 text-brand-amber" />
                  <span>Leer van mijn correcties — voeg lessen toe aan de AI-regels</span>
                </label>
              </div>
            )}

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
