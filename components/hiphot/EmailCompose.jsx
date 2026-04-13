"use client";

import { useState, useEffect } from "react";
import { X, Sparkles, Send, Loader2, Paperclip, FileText, ChevronDown } from "lucide-react";
import { apiFetch } from "@/lib/api";

function replacePlaceholders(text, vars) {
  return text
    .replace(/\{\{voornaam\}\}/g, vars.voornaam || "")
    .replace(/\{\{bedrijf\}\}/g, vars.bedrijf || "")
    .replace(/\{\{offerte_nummer\}\}/g, vars.offerte_nummer || "")
    .replace(/\{\{offerte_link\}\}/g, vars.offerte_link || "")
    .replace(/\{\{bedrag\}\}/g, vars.bedrag || "")
    .replace(/\{\{afzender\}\}/g, vars.afzender || "");
}

export default function EmailCompose({ open, onClose, quoteId, defaultTo, onSent, lead, quoteData }) {
  const [to, setTo] = useState(defaultTo || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  // Attachments
  const [stdAttachments, setStdAttachments] = useState([]);
  const [selectedAttachments, setSelectedAttachments] = useState([]);

  // Load templates + attachments on open
  useEffect(() => {
    if (!open) return;
    setTo(defaultTo || "");
    setCc("");
    setSubject("");
    setBodyHtml("");
    setError("");
    setSent(false);
    setSelectedTemplate("");
    setSelectedAttachments([]);

    apiFetch("/api/email-templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => {});

    apiFetch("/api/email-attachments")
      .then((r) => r.json())
      .then((d) => setStdAttachments(d.attachments || []))
      .catch(() => {});
  }, [open, defaultTo]);

  // Build placeholder variables from lead + quote data
  const placeholderVars = {
    voornaam: lead?.contact_person?.split(" ")[0] || lead?.contact_person || "",
    bedrijf: lead?.company_name || "",
    offerte_nummer: quoteData?.quote_number || "",
    offerte_link: quoteData?.public_hash
      ? `${typeof window !== "undefined" ? window.location.origin : "https://crm.48-7.nl"}/offerte/${quoteData.public_hash}`
      : "",
    bedrag: quoteData?.amount_excl_vat
      ? new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(quoteData.amount_excl_vat)
      : "",
    afzender: "", // Will be filled from user context if available
  };

  function handleTemplateSelect(templateId) {
    setSelectedTemplate(templateId);
    if (!templateId) return;
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    setSubject(replacePlaceholders(tmpl.subject, placeholderVars));
    setBodyHtml(replacePlaceholders(tmpl.body_html, placeholderVars));
  }

  function toggleAttachment(id) {
    setSelectedAttachments((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

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
      setSelectedTemplate("");
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
        body: JSON.stringify({
          to,
          cc: cc || null,
          subject,
          body_html: bodyHtml,
          attachment_ids: selectedAttachments.length ? selectedAttachments : undefined,
        }),
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

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
            {selectedAttachments.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {selectedAttachments.length} bijlage{selectedAttachments.length > 1 ? "n" : ""} meegestuurd
              </p>
            )}
          </div>
        ) : (
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</div>
            )}

            {/* Template selector */}
            {templates.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Template</label>
                <div className="relative mt-1">
                  <select
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateSelect(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber appearance-none bg-white pr-8"
                  >
                    <option value="">— Kies een template of gebruik AI —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
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

            {/* Attachments */}
            {stdAttachments.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" />
                  Bijlagen
                </label>
                <div className="mt-2 space-y-1.5">
                  {stdAttachments.map((att) => (
                    <label
                      key={att.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                        selectedAttachments.includes(att.id)
                          ? "border-brand-amber bg-amber-50"
                          : "border-gray-100 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedAttachments.includes(att.id)}
                        onChange={() => toggleAttachment(att.id)}
                        className="rounded border-gray-300 text-brand-amber focus:ring-brand-amber"
                      />
                      <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-700 flex-1">{att.name}</span>
                      <span className="text-xs text-gray-400">{formatFileSize(att.file_size)}</span>
                    </label>
                  ))}
                </div>
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
                {selectedAttachments.length > 0
                  ? `Versturen (${selectedAttachments.length} bijlage${selectedAttachments.length > 1 ? "n" : ""})`
                  : "Versturen"
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
