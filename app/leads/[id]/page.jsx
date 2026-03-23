"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import ActivityTimeline from "@/components/ActivityTimeline";
import QuoteForm from "@/components/QuoteForm";
import NoteForm from "@/components/NoteForm";
import LeadForm from "@/components/LeadForm";
import CoworkBar from "@/components/CoworkBar";
import AttachmentUpload from "@/components/AttachmentUpload";
import { formatCurrency, formatDate, formatRelativeTime, formatDateTime } from "@/lib/utils";
import { LEAD_STATUSES, SERVICE_TYPES, NOTE_TYPES, QUOTE_STATUSES } from "@/lib/constants";
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  Tag,
  DollarSign,
  Globe,
  FileText,
  Plus,
  MessageSquare,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  Pencil,
  X,
  Save,
  Link2,
  ExternalLink,
  Sparkles,
  AlertCircle,
} from "lucide-react";

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  // Collapsible sections
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  // Inline editing
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [editQuoteDesc, setEditQuoteDesc] = useState("");

  // AI summary
  const [aiLoading, setAiLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [leadRes, attachRes] = await Promise.all([
        fetch(`/api/leads/${params.id}`),
        fetch(`/api/attachments?lead_id=${params.id}`),
      ]);
      if (!leadRes.ok) {
        router.push("/leads");
        return;
      }
      const result = await leadRes.json();
      const attachData = await attachRes.json();
      result.attachments = attachData.attachments || [];
      setData(result);
    } catch {
      router.push("/leads");
    } finally {
      setLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function updateStatus(newStatus) {
    setShowStatusMenu(false);
    await fetch(`/api/leads/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchData();
  }

  async function toggleTodo(noteId, isCompleted) {
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: !isCompleted }),
    });
    fetchData();
  }

  async function deleteNote(noteId) {
    await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    fetchData();
  }

  async function saveNoteEdit(noteId) {
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editNoteContent }),
    });
    setEditingNoteId(null);
    fetchData();
  }

  async function deleteQuote(quoteId) {
    await fetch(`/api/quotes/${quoteId}`, { method: "DELETE" });
    fetchData();
  }

  async function saveQuoteEdit(quoteId) {
    await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: editQuoteDesc }),
    });
    setEditingQuoteId(null);
    fetchData();
  }

  async function updateQuoteStatus(quoteId, newStatus) {
    await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchData();
  }

  async function generateAiSummary() {
    setAiLoading(true);
    try {
      const res = await fetch(`/api/leads/${params.id}/summary`, { method: "POST" });
      const result = await res.json();
      if (result.summary) {
        fetchData();
      }
    } catch {}
    setAiLoading(false);
  }

  if (loading || !data) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  const { lead, quotes, notes, activities, attachments } = data;
  const serviceLabel = SERVICE_TYPES.find((s) => s.id === lead.service_type)?.label;

  // Find missing/empty fields
  const missingFields = [];
  if (!lead.phone) missingFields.push("Telefoon");
  if (!lead.service_type) missingFields.push("Service type");
  if (!lead.estimated_value) missingFields.push("Geschatte waarde");
  if (!lead.source) missingFields.push("Bron");
  if (!lead.website_url) missingFields.push("Website");

  // Convert markdown-style AI summary to HTML
  function formatAiSummary(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/gs, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>')
      .replace(/<p><h/g, '<h')
      .replace(/<\/h([234])><\/p>/g, '</h$1>')
      .replace(/<p><ul>/g, '<ul>')
      .replace(/<\/ul><\/p>/g, '</ul>');
  }

  const filteredNotes =
    activeTab === "all"
      ? notes
      : activeTab === "todo"
      ? notes.filter((n) => n.note_type === "todo")
      : notes.filter((n) => n.note_type === activeTab);

  return (
    <AppShell>
      {/* Back link */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-black mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Terug
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-brand-black">
              {lead.company_name}
            </h1>
            <StatusBadge status={lead.status} size="md" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">
              {lead.contact_person} &middot; Aangemaakt {formatRelativeTime(lead.created_at)}
            </p>
            {lead.website_url && (
              <a
                href={lead.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-brand-orange hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Website
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:border-brand-amber transition-colors"
            >
              Status wijzigen
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showStatusMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-lg border border-gray-100 py-1 z-50">
                {LEAD_STATUSES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => updateStatus(s.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      s.id === lead.status ? "text-brand-orange font-medium" : ""
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowNoteForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:border-brand-amber transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            Notitie
          </button>

          <button
            onClick={() => setShowQuoteForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors"
          >
            <FileText className="w-4 h-4" />
            Offerte
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Contact info */}
          <div className="bg-white border border-gray-100 rounded-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Contactgegevens
              </h3>
              <button
                onClick={() => setShowLeadForm(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Bewerken
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-gray-400" />
                <a href={`mailto:${lead.email}`} className="text-sm text-brand-orange hover:underline">
                  {lead.email}
                </a>
              </div>
              {lead.phone ? (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <a href={`tel:${lead.phone}`} className="text-sm hover:underline">
                    {lead.phone}
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-gray-300" />
                  <span className="text-sm text-gray-300 italic">Geen telefoon</span>
                </div>
              )}
              {serviceLabel ? (
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-gray-400" />
                  <span className="text-sm">{serviceLabel}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-gray-300" />
                  <span className="text-sm text-gray-300 italic">Geen service type</span>
                </div>
              )}
              {lead.estimated_value ? (
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium">
                    {formatCurrency(lead.estimated_value)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-300" />
                  <span className="text-sm text-gray-300 italic">Geen waarde</span>
                </div>
              )}
              {lead.source ? (
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-gray-400" />
                  <span className="text-sm capitalize">{lead.source}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-gray-300" />
                  <span className="text-sm text-gray-300 italic">Geen bron</span>
                </div>
              )}
              {lead.website_url ? (
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-gray-400" />
                  <a
                    href={lead.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-orange hover:underline flex items-center gap-1 truncate"
                  >
                    {lead.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-gray-300" />
                  <span className="text-sm text-gray-300 italic">Geen website</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-500">
                  {formatDate(lead.created_at)}
                </span>
              </div>
            </div>

            {/* Missing fields warning */}
            {missingFields.length > 0 && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 rounded-xl">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-700">Ontbrekende gegevens</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    {missingFields.join(", ")}
                  </p>
                </div>
                <button
                  onClick={() => setShowLeadForm(true)}
                  className="ml-auto text-xs font-semibold text-amber-700 hover:text-amber-900 whitespace-nowrap"
                >
                  Aanvullen →
                </button>
              </div>
            )}
          </div>

          {/* AI Summary */}
          <div className="bg-white border border-gray-100 rounded-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-brand-orange" />
                AI Bedrijfsanalyse
              </h3>
              <button
                onClick={generateAiSummary}
                disabled={aiLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors disabled:opacity-50"
              >
                {aiLoading ? (
                  <>
                    <div className="w-3 h-3 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
                    Analyseren...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    {lead.ai_summary ? "Opnieuw analyseren" : "Genereer analyse"}
                  </>
                )}
              </button>
            </div>
            {lead.ai_summary ? (
              <div
                className="text-sm text-brand-dark-gray leading-relaxed prose prose-sm prose-headings:text-brand-black prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 max-w-none"
                dangerouslySetInnerHTML={{ __html: formatAiSummary(lead.ai_summary) }}
              />
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">
                Klik op &quot;Genereer analyse&quot; voor een AI-samenvatting van dit bedrijf en kansen voor 48-7.
              </p>
            )}
          </div>

          {/* Quotes - Collapsible */}
          <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
            <button
              onClick={() => setQuotesOpen(!quotesOpen)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${quotesOpen ? "rotate-90" : ""}`} />
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Offertes ({quotes.length})
                </h3>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowQuoteForm(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Toevoegen
              </button>
            </button>

            {quotesOpen && (
              <div className="px-5 pb-4">
                {quotes.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">
                    Nog geen offertes
                  </p>
                ) : (
                  <div className="space-y-3">
                    {quotes.map((q) => {
                      const qStatus = QUOTE_STATUSES.find((s) => s.id === q.status);
                      const isEditing = editingQuoteId === q.id;
                      return (
                        <div key={q.id} className="bg-brand-light-gray rounded-xl overflow-hidden group">
                          <div className="flex items-center justify-between px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">{q.quote_number}</span>
                                <span className="text-sm font-medium text-brand-dark-gray">
                                  {formatCurrency(q.amount_excl_vat)}
                                </span>
                              </div>
                              {isEditing ? (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <input
                                    type="text"
                                    value={editQuoteDesc}
                                    onChange={(e) => setEditQuoteDesc(e.target.value)}
                                    className="flex-1 text-xs px-2 py-1 rounded-lg border border-brand-amber bg-white focus:outline-none"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => saveQuoteEdit(q.id)}
                                    className="p-1 rounded-lg text-green-600 hover:bg-green-50"
                                  >
                                    <Save className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setEditingQuoteId(null)}
                                    className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                q.description && (
                                  <p className="text-xs text-gray-500 mt-0.5 truncate max-w-sm">
                                    {q.description}
                                  </p>
                                )
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                value={q.status}
                                onChange={(e) => updateQuoteStatus(q.id, e.target.value)}
                                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill border-0 cursor-pointer appearance-none text-center ${
                                  q.status === "geaccepteerd"
                                    ? "bg-green-100 text-green-700"
                                    : q.status === "verstuurd"
                                    ? "bg-blue-100 text-blue-700"
                                    : q.status === "afgewezen"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {QUOTE_STATUSES.map((s) => (
                                  <option key={s.id} value={s.id}>{s.label}</option>
                                ))}
                              </select>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => {
                                    setEditingQuoteId(q.id);
                                    setEditQuoteDesc(q.description || "");
                                  }}
                                  className="p-1 rounded-lg text-gray-400 hover:text-brand-orange hover:bg-white transition-colors"
                                  title="Bewerken"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteQuote(q.id)}
                                  className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-white transition-colors"
                                  title="Verwijderen"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="px-3 pb-3">
                            <AttachmentUpload
                              leadId={params.id}
                              quoteId={q.id}
                              attachments={attachments}
                              onUploaded={fetchData}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Attachments - Collapsible */}
          <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
            <button
              onClick={() => setAttachmentsOpen(!attachmentsOpen)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${attachmentsOpen ? "rotate-90" : ""}`} />
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Bijlagen ({attachments.length})
                </h3>
              </div>
            </button>

            {attachmentsOpen && (
              <div className="px-5 pb-4">
                <AttachmentUpload
                  leadId={params.id}
                  attachments={attachments}
                  onUploaded={fetchData}
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white border border-gray-100 rounded-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Notities ({notes.length})
              </h3>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1">
                {[
                  { id: "all", label: "Alles" },
                  { id: "gesprek", label: "Gesprekken" },
                  { id: "todo", label: "To-do's" },
                  { id: "intern", label: "Intern" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition-colors ${
                      activeTab === tab.id
                        ? "bg-brand-amber text-brand-black"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowNoteForm(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Toevoegen
              </button>
            </div>

            {filteredNotes.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                Geen notities
              </p>
            ) : (
              <div className="space-y-3">
                {filteredNotes.map((note) => {
                  const typeLabel = NOTE_TYPES.find(
                    (t) => t.id === note.note_type
                  )?.label;
                  const isEditing = editingNoteId === note.id;

                  return (
                    <div
                      key={note.id}
                      className={`px-3 py-3 rounded-xl border group ${
                        note.note_type === "todo" && note.is_completed
                          ? "bg-gray-50 border-gray-100 opacity-60"
                          : "bg-white border-gray-100"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {note.note_type === "todo" && (
                          <button
                            onClick={() => toggleTodo(note.id, note.is_completed)}
                            className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                              note.is_completed
                                ? "bg-green-500 border-green-500"
                                : "border-gray-300 hover:border-brand-amber"
                            }`}
                          >
                            {note.is_completed && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </button>
                        )}
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex items-start gap-1.5">
                              <textarea
                                value={editNoteContent}
                                onChange={(e) => setEditNoteContent(e.target.value)}
                                rows={2}
                                className="flex-1 text-sm px-2 py-1 rounded-lg border border-brand-amber bg-white focus:outline-none resize-none"
                                autoFocus
                              />
                              <button
                                onClick={() => saveNoteEdit(note.id)}
                                className="p-1 rounded-lg text-green-600 hover:bg-green-50"
                              >
                                <Save className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingNoteId(null)}
                                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <p
                              className={`text-sm whitespace-pre-line ${
                                note.note_type === "todo" && note.is_completed
                                  ? "line-through text-gray-400"
                                  : "text-brand-dark-gray"
                              }`}
                            >
                              {note.content}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-pill bg-gray-100 text-gray-500">
                              {typeLabel}
                            </span>
                            {note.due_date && (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-pill flex items-center gap-1 ${
                                !note.is_completed && new Date(note.due_date) < new Date()
                                  ? "bg-red-100 text-red-600"
                                  : !note.is_completed && new Date(note.due_date) < new Date(Date.now() + 24 * 60 * 60 * 1000)
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-blue-50 text-blue-600"
                              }`}>
                                <Calendar className="w-2.5 h-2.5" />
                                {formatDateTime(note.due_date)}
                              </span>
                            )}
                            <span className="text-xs text-gray-400">
                              {formatRelativeTime(note.created_at)}
                            </span>
                            {note.created_by && (
                              <span className="text-xs text-gray-400">
                                door {note.created_by}
                              </span>
                            )}
                          </div>
                        </div>

                        {!isEditing && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setEditingNoteId(note.id);
                                setEditNoteContent(note.content);
                              }}
                              className="p-1 rounded-lg text-gray-300 hover:text-brand-orange hover:bg-amber-50 transition-colors"
                              title="Bewerken"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Verwijderen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Activity Timeline */}
        <div>
          <div className="bg-white border border-gray-100 rounded-card p-5 sticky top-20">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Activiteiten
            </h3>
            <ActivityTimeline activities={activities} />
          </div>
        </div>
      </div>

      {/* Modals */}
      <QuoteForm
        open={showQuoteForm}
        onClose={() => setShowQuoteForm(false)}
        leadId={params.id}
        onSaved={fetchData}
      />
      <NoteForm
        open={showNoteForm}
        onClose={() => setShowNoteForm(false)}
        leadId={params.id}
        onSaved={fetchData}
      />
      <LeadForm
        open={showLeadForm}
        onClose={() => setShowLeadForm(false)}
        onSaved={fetchData}
        lead={lead}
      />
      <CoworkBar onResult={() => fetchData()} />
    </AppShell>
  );
}
