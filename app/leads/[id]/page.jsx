"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import ActivityTimeline from "@/components/ActivityTimeline";
import QuoteForm from "@/components/QuoteForm";
import HipHotQuoteBuilder from "@/components/HipHotQuoteBuilder";
import QuoteEmailLog from "@/components/hiphot/QuoteEmailLog";
import EmailCompose from "@/components/hiphot/EmailCompose";
import NoteForm from "@/components/NoteForm";
import LeadForm from "@/components/LeadForm";
import QuoteToOrderModal from "@/components/QuoteToOrderModal";
import AIQuoteAdvisor from "@/components/AIQuoteAdvisor";
import AttachmentUpload from "@/components/AttachmentUpload";
import ContactsPanel from "@/components/ContactsPanel";
import { formatCurrency, formatDate, formatRelativeTime, formatDateTime } from "@/lib/utils";
import { LEAD_STATUSES, SERVICE_TYPES, NOTE_TYPES, QUOTE_STATUSES, getLeadStatuses, INDUSTRIES, SOURCES } from "@/lib/constants";
import { useOrg } from "@/lib/org-context";
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
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  MailPlus,
  UserX,
  Users,
  MapPin,
  Building2,
  ShoppingBag,
  Hash,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

const CALL_OUTCOMES = [
  { id: "voorstel_mailen", label: "Voorstel mailen", icon: MailPlus, color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" },
  { id: "terugbellen_5_dagen", label: "Terugbellen", icon: PhoneForwarded, color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { id: "geen_gehoor_terugbellen", label: "Geen gehoor", icon: PhoneOff, color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100" },
  { id: "niet_geinteresseerd", label: "Niet geïnteresseerd", icon: UserX, color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" },
  { id: "vraag_opvolgen_collega", label: "Interne collega opvolgen", icon: PhoneCall, color: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100" },
];

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { tenant, user } = useOrg();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [showHipHotBuilder, setShowHipHotBuilder] = useState(false);
  const [editHipHotQuoteId, setEditHipHotQuoteId] = useState(null);
  const [showEmailCompose, setShowEmailCompose] = useState(null); // quote ID
  const [emailQuoteOverride, setEmailQuoteOverride] = useState(null); // quoteData from publish flow
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [callNote, setCallNote] = useState("");
  const [callingOutcome, setCallingOutcome] = useState(null);
  const [colleaguePickerOpen, setColleaguePickerOpen] = useState(false);
  const [colleagues, setColleagues] = useState([]);
  const [orderModalQuote, setOrderModalQuote] = useState(null); // { quote, lineItems }
  const [loadingOrderModal, setLoadingOrderModal] = useState(false);
  const [showAdvisor, setShowAdvisor] = useState(false);

  // Collapsible sections
  const [quotesOpen, setQuotesOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [callOutcomeOpen, setCallOutcomeOpen] = useState(false);

  // Inline editing
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [editQuoteDesc, setEditQuoteDesc] = useState("");

  // AI summary
  const [aiLoading, setAiLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [leadRes, attachRes, contactsRes] = await Promise.all([
        apiFetch(`/api/leads/${params.id}`),
        apiFetch(`/api/attachments?lead_id=${params.id}`),
        apiFetch(`/api/contacts?lead_id=${params.id}`),
      ]);
      if (!leadRes.ok) {
        router.push("/leads");
        return;
      }
      const result = await leadRes.json();
      const attachData = await attachRes.json();
      const contactsData = await contactsRes.json();
      result.attachments = attachData.attachments || [];
      result.contacts = contactsData.contacts || [];
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
    await apiFetch(`/api/leads/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchData();
  }

  async function toggleTodo(noteId, isCompleted) {
    await apiFetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: !isCompleted }),
    });
    fetchData();
  }

  async function deleteNote(noteId) {
    await apiFetch(`/api/notes/${noteId}`, { method: "DELETE" });
    fetchData();
  }

  async function saveNoteEdit(noteId) {
    await apiFetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editNoteContent }),
    });
    setEditingNoteId(null);
    fetchData();
  }

  async function deleteQuote(quoteId) {
    await apiFetch(`/api/quotes/${quoteId}`, { method: "DELETE" });
    fetchData();
  }

  async function saveQuoteEdit(quoteId) {
    await apiFetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: editQuoteDesc }),
    });
    setEditingQuoteId(null);
    fetchData();
  }

  async function updateQuoteStatus(quoteId, newStatus) {
    await apiFetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchData();
  }

  async function publishQuote(quoteId) {
    await apiFetch(`/api/quotes/${quoteId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    fetchData();
  }

  async function openOrderModal(quote) {
    if (loadingOrderModal) return;
    setLoadingOrderModal(true);
    try {
      const res = await apiFetch(`/api/hiphot/quote-items?quote_id=${quote.id}`);
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || "Kon regels niet ophalen");
        return;
      }
      setOrderModalQuote({ quote, lineItems: d.items || [] });
    } catch (err) {
      alert(`Fout: ${err.message}`);
    } finally {
      setLoadingOrderModal(false);
    }
  }

  async function submitCallOutcome(outcomeId, extra = {}) {
    setCallingOutcome(outcomeId);
    try {
      await apiFetch(`/api/leads/${params.id}/call-outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: outcomeId,
          note: callNote || null,
          user_id: user?.id,
          user_name: user?.name,
          ...extra,
        }),
      });
      setCallNote("");
      setColleaguePickerOpen(false);
      fetchData();
    } catch {}
    setCallingOutcome(null);
  }

  async function openColleaguePicker() {
    setColleaguePickerOpen(true);
    if (colleagues.length === 0) {
      try {
        const res = await apiFetch("/api/admin/users");
        const data = await res.json();
        const list = (data.users || []).filter((u) => u.is_active !== false && u.id !== user?.id);
        setColleagues(list);
      } catch {}
    }
  }

  async function generateAiSummary() {
    setAiLoading(true);
    try {
      const res = await apiFetch(`/api/leads/${params.id}/summary`, { method: "POST" });
      const result = await res.json();
      if (result.summary) {
        fetchData();
      } else if (result.error) {
        console.error("AI summary error:", result.error);
        alert(`AI analyse mislukt: ${result.error}`);
      }
    } catch (err) {
      console.error("AI summary fetch failed:", err);
    }
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

  const { lead, quotes, notes, activities, attachments, contacts } = data;
  const isHipHot = lead.tenant === "hiphot";
  const serviceLabel = SERVICE_TYPES.find((s) => s.id === lead.service_type)?.label;

  // Find missing/empty fields
  const missingFields = [];
  if (!lead.phone) missingFields.push("Telefoon");
  if (isHipHot) {
    if (!lead.industry && !lead.category) missingFields.push("Branche");
  } else {
    if (!lead.service_type) missingFields.push("Service type");
    if (!lead.estimated_value) missingFields.push("Geschatte waarde");
    if (!lead.source) missingFields.push("Bron");
  }
  if (!lead.website_url) missingFields.push("Website");

  // Convert markdown-style AI summary to clean HTML
  function formatAiSummary(text) {
    const lines = text.split('\n');
    let html = '';
    let inList = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inList) { html += '</ul>'; inList = false; }
        continue;
      }

      // Headers: ## Heading or **Heading:** or **Heading**
      const h2Match = trimmed.match(/^#{1,3}\s+(.+)$/);
      const boldHeaderMatch = trimmed.match(/^\*\*([^*]+?)(?::?\s*)\*\*\s*$/);
      if (h2Match || boldHeaderMatch) {
        if (inList) { html += '</ul>'; inList = false; }
        const title = (h2Match ? h2Match[1] : boldHeaderMatch[1]).replace(/\*\*/g, '');
        html += `<h3>${title}</h3>`;
        continue;
      }

      // Bullet points: - item or • item
      const bulletMatch = trimmed.match(/^[-•]\s+(.+)$/);
      if (bulletMatch) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${bulletMatch[1].replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</li>`;
        continue;
      }

      // Regular paragraph text
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${trimmed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    }

    if (inList) html += '</ul>';
    return html;
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
              {lead.contact_first_name && lead.contact_last_name
                ? `${lead.contact_first_name} ${lead.contact_last_name}`
                : lead.contact_person}
              {lead.contact_function && <span className="text-gray-400"> — {lead.contact_function}</span>}
              {" "}· Aangemaakt {formatRelativeTime(lead.created_at)}
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
                {getLeadStatuses(tenant).map((s) => (
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
            onClick={() => isHipHot ? setShowHipHotBuilder(true) : setShowQuoteForm(true)}
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
              {isHipHot ? (
                <>
                  {lead.industry && (
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="text-sm">
                        {INDUSTRIES.find((i) => i.id === lead.industry)?.label || lead.industry}
                      </span>
                    </div>
                  )}
                  {lead.category && (
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500">{lead.category}</span>
                    </div>
                  )}
                  {!lead.industry && !lead.category && (
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-gray-300" />
                      <span className="text-sm text-gray-300 italic">Geen branche</span>
                    </div>
                  )}
                </>
              ) : serviceLabel ? (
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
                  <span className="text-sm">
                    {SOURCES.find((s) => s.id === lead.source)?.label || lead.source}
                  </span>
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

          {/* Addresses & facturatie */}
          <div className="bg-white border border-gray-100 rounded-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Adressen &amp; facturatie
              </h3>
              <button
                onClick={() => setShowLeadForm(true)}
                className="text-xs font-semibold text-brand-amber hover:underline"
              >
                Bewerken
              </button>
            </div>

            {(() => {
              const hasBilling = lead.billing_street || lead.billing_city || lead.billing_postal_code;
              const sameAsBilling = lead.delivery_same_as_billing !== false;
              const hasDelivery = !sameAsBilling && (lead.delivery_street || lead.delivery_city || lead.delivery_postal_code);
              if (!hasBilling && !lead.billing_email && !lead.customer_reference) {
                return (
                  <p className="text-sm text-gray-400 italic">
                    Geen factuur- of leveradres opgegeven.{" "}
                    <button
                      onClick={() => setShowLeadForm(true)}
                      className="text-brand-amber font-medium hover:underline not-italic"
                    >
                      Toevoegen →
                    </button>
                  </p>
                );
              }
              return (
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    {lead.customer_reference && (
                      <div className="flex items-start gap-2">
                        <Hash className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Klantreferentie</p>
                          <p className="text-sm text-gray-700">{lead.customer_reference}</p>
                        </div>
                      </div>
                    )}
                    {lead.billing_email && (
                      <div className="flex items-start gap-2">
                        <Mail className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Factuur-e-mail</p>
                          <a href={`mailto:${lead.billing_email}`} className="text-sm text-gray-700 hover:text-brand-amber break-all">
                            {lead.billing_email}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  {hasBilling && (
                    <div className="flex items-start gap-2">
                      <Building2 className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Factuuradres</p>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {[lead.billing_street, lead.billing_house_number].filter(Boolean).join(" ")}
                          {lead.billing_street && <br />}
                          {[lead.billing_postal_code, lead.billing_city].filter(Boolean).join(" ")}
                          {(lead.billing_postal_code || lead.billing_city) && <br />}
                          {lead.billing_country && lead.billing_country !== "NL" ? lead.billing_country : ""}
                        </p>
                      </div>
                    </div>
                  )}

                  {hasDelivery && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Leveradres</p>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {[lead.delivery_street, lead.delivery_house_number].filter(Boolean).join(" ")}
                          {lead.delivery_street && <br />}
                          {[lead.delivery_postal_code, lead.delivery_city].filter(Boolean).join(" ")}
                          {(lead.delivery_postal_code || lead.delivery_city) && <br />}
                          {lead.delivery_country && lead.delivery_country !== "NL" ? lead.delivery_country : ""}
                        </p>
                      </div>
                    </div>
                  )}

                  {sameAsBilling && hasBilling && (
                    <p className="text-xs text-gray-400 italic flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" />
                      Leveradres is hetzelfde als factuuradres
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Contacts */}
          <div className="bg-white border border-gray-100 rounded-card p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Contactpersonen ({contacts?.length || 0})
            </h3>
            <ContactsPanel
              leadId={params.id}
              contacts={contacts || []}
              onUpdate={fetchData}
            />
          </div>

          {/* Call Outcome Panel (HipHot only) - Collapsible */}
          {isHipHot && (
            <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
              <button
                onClick={() => setCallOutcomeOpen(!callOutcomeOpen)}
                className="w-full flex items-center gap-2 px-5 py-3 hover:bg-gray-50/50 transition-colors"
              >
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${callOutcomeOpen ? "rotate-90" : ""}`} />
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <PhoneCall className="w-3.5 h-3.5 text-green-600" />
                  Bel-uitkomst registreren
                </h3>
              </button>
              {callOutcomeOpen && (
              <div className="px-5 pb-4">

              {lead.call_outcome && (
                <div className="mb-3 px-3 py-2 bg-gray-50 rounded-xl">
                  <p className="text-xs text-gray-500">Laatste uitkomst:</p>
                  <p className="text-sm font-medium">
                    {CALL_OUTCOMES.find((c) => c.id === lead.call_outcome)?.label || lead.call_outcome}
                  </p>
                  {lead.last_called_at && (
                    <p className="text-xs text-gray-400 mt-0.5">{formatRelativeTime(lead.last_called_at)}</p>
                  )}
                </div>
              )}

              {/* Optional note */}
              <textarea
                value={callNote}
                onChange={(e) => setCallNote(e.target.value)}
                placeholder="Optionele notitie bij gesprek..."
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber resize-none mb-3"
              />

              {/* Outcome buttons */}
              <div className="grid grid-cols-1 gap-2">
                {CALL_OUTCOMES.map((outcome) => {
                  const isActive = lead.call_outcome === outcome.id;
                  const isColleague = outcome.id === "vraag_opvolgen_collega";
                  return (
                  <button
                    key={outcome.id}
                    onClick={() => (isColleague ? openColleaguePicker() : submitCallOutcome(outcome.id))}
                    disabled={callingOutcome === outcome.id}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${outcome.color} ${
                      isActive ? "!border-brand-black ring-1 ring-brand-black/20" : ""
                    } ${callingOutcome === outcome.id ? "opacity-50" : ""}`}
                  >
                    <outcome.icon className="w-4 h-4" />
                    {outcome.label}
                    {isActive && <Check className="w-4 h-4 ml-auto" />}
                  </button>
                  );
                })}
              </div>

              {/* Colleague picker for "Interne collega opvolgen" */}
              {colleaguePickerOpen && (
                <div className="mt-3 px-3 py-3 bg-purple-50/60 border border-purple-200 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 uppercase tracking-wide">
                      <Users className="w-3.5 h-3.5" />
                      Kies collega
                    </div>
                    <button
                      onClick={() => setColleaguePickerOpen(false)}
                      className="p-1 rounded-md hover:bg-purple-100 text-purple-500"
                      aria-label="Sluiten"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {colleagues.length === 0 ? (
                    <p className="text-xs text-purple-600/70 italic">Geen collega&apos;s gevonden</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-1.5">
                      {colleagues.map((c) => (
                        <button
                          key={c.id}
                          onClick={() =>
                            submitCallOutcome("vraag_opvolgen_collega", {
                              follow_up_user_id: c.id,
                              follow_up_user_name: c.name,
                            })
                          }
                          disabled={callingOutcome === "vraag_opvolgen_collega"}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-purple-200 hover:bg-purple-100 text-sm font-medium text-purple-800 transition-colors disabled:opacity-50"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>{c.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Volgende bellen button */}
              {lead.call_outcome && (
                <button
                  onClick={async () => {
                    const res = await apiFetch("/api/leads?sort=created_at&order=asc");
                    const data = await res.json();
                    const next = data.leads?.find((l) =>
                      l.id !== lead.id &&
                      !l.call_outcome &&
                      l.status !== "offerte_verloren" &&
                      l.status !== "offerte_gewonnen"
                    );
                    if (next) router.push(`/leads/${next.id}`);
                    else alert("Geen ongebelde leads meer!");
                  }}
                  className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-semibold transition-colors"
                >
                  <PhoneCall className="w-4 h-4" />
                  Volgende bellen
                </button>
              )}
              </div>
              )}
            </div>
          )}

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
                  { id: "formulier", label: "Formulier" },
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

        {/* Right column */}
        <div className="space-y-4">
          {/* AI Summary - Collapsible */}
          <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
            <button
              onClick={() => setAiSummaryOpen(!aiSummaryOpen)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${aiSummaryOpen ? "rotate-90" : ""}`} />
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-brand-orange" />
                  AI Bedrijfsanalyse
                </h3>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); generateAiSummary(); }}
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
                    {lead.ai_summary ? "Opnieuw" : "Analyseer"}
                  </>
                )}
              </button>
            </button>
            {aiSummaryOpen && (
              <div className="px-5 pb-4">
                {lead.ai_summary ? (
                  <div
                    className="text-sm text-brand-dark-gray leading-relaxed max-w-none [&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-gray-500 [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3:first-child]:mt-0 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:pl-4 [&_ul]:list-disc [&_li]:mb-1 [&_strong]:font-semibold [&_strong]:text-brand-black"
                    dangerouslySetInnerHTML={{ __html: formatAiSummary(lead.ai_summary) }}
                  />
                ) : (
                  <p className="text-sm text-gray-400 text-center py-3">
                    Klik &quot;Analyseer&quot; voor AI-samenvatting
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Quotes - Collapsible */}
          <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
            <button
              onClick={() => setQuotesOpen(!quotesOpen)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${quotesOpen ? "rotate-90" : ""}`} />
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Offertes ({quotes.length})
                </h3>
              </div>
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {isHipHot && (
                  <button
                    onClick={() => setShowAdvisor(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-gradient-to-r from-brand-amber to-amber-400 text-brand-black text-[10px] font-semibold hover:opacity-90 transition-opacity"
                    title="AI offerte-advies op basis van notities, aanvragen en lead-info"
                  >
                    <Sparkles className="w-3 h-3" />
                    AI-advies
                  </button>
                )}
                <button
                  onClick={() => { isHipHot ? setShowHipHotBuilder(true) : setShowQuoteForm(true); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </button>
            {quotesOpen && (
              <div className="px-5 pb-4">
                {quotes.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-3">Nog geen offertes</p>
                ) : (
                  <div className="space-y-2">
                    {quotes.map((q) => {
                      const isEditing = editingQuoteId === q.id;
                      return (
                        <div key={q.id} className="bg-brand-light-gray rounded-xl p-2.5 group">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <span className="text-xs font-semibold">{q.quote_number}</span>
                              <span className="text-xs text-brand-dark-gray ml-1.5">{formatCurrency(q.amount_excl_vat)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <select
                                value={q.status}
                                onChange={(e) => updateQuoteStatus(q.id, e.target.value)}
                                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-pill border-0 cursor-pointer ${
                                  q.status === "geaccepteerd" ? "bg-green-100 text-green-700"
                                  : q.status === "verstuurd" ? "bg-blue-100 text-blue-700"
                                  : q.status === "afgewezen" ? "bg-red-100 text-red-700"
                                  : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {QUOTE_STATUSES.map((s) => (
                                  <option key={s.id} value={s.id}>{s.label}</option>
                                ))}
                              </select>
                              {isHipHot && (
                                <button
                                  onClick={() => { setEditHipHotQuoteId(q.id); setShowHipHotBuilder(true); }}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  title="Offerte bewerken"
                                >
                                  Bewerken
                                </button>
                              )}
                              <button onClick={() => deleteQuote(q.id)} className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          {q.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{q.description}</p>}
                          {/* Publish / Link */}
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {q.public_hash ? (
                              <>
                                <button
                                  onClick={() => {
                                    const url = `${window.location.origin}/offerte/${q.public_hash}`;
                                    navigator.clipboard.writeText(url);
                                    alert("Link gekopieerd!");
                                  }}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap"
                                >
                                  Link kopiëren
                                </button>
                                <a
                                  href={`/offerte/${q.public_hash}`}
                                  target="_blank"
                                  rel="noopener"
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-blue-50 text-blue-600 hover:bg-blue-100 whitespace-nowrap"
                                >
                                  Bekijken ↗
                                </a>
                                <button
                                  onClick={() => setShowEmailCompose(q.id)}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-purple-50 text-purple-600 hover:bg-purple-100 whitespace-nowrap"
                                >
                                  Mailen
                                </button>
                                {isHipHot && q.status === "geaccepteerd" && !q.external_order_id && (
                                  <button
                                    onClick={() => openOrderModal(q)}
                                    disabled={loadingOrderModal}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-brand-amber/20 text-brand-orange hover:bg-brand-amber/30 disabled:opacity-50 whitespace-nowrap"
                                    title="Offerte omzetten naar webshop-order"
                                  >
                                    Maak order
                                  </button>
                                )}
                                {q.external_order_id && (
                                  <a
                                    href={q.external_order_url || "#"}
                                    target="_blank"
                                    rel="noopener"
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-green-100 text-green-700 hover:bg-green-200 whitespace-nowrap"
                                    title={`Order in ${q.external_order_platform || "webshop"}`}
                                  >
                                    Order #{q.external_order_id} ↗
                                  </a>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={() => publishQuote(q.id)}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-brand-amber/10 text-brand-orange hover:bg-brand-amber/20"
                              >
                                Publiceer offerte
                              </button>
                            )}
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
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50/50 transition-colors"
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
                <AttachmentUpload leadId={params.id} attachments={attachments} onUploaded={fetchData} />
              </div>
            )}
          </div>

          {/* Email log */}
          <QuoteEmailLog leadId={params.id} />

          {/* Activity Timeline */}
          <div className="bg-white border border-gray-100 rounded-card p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Activiteiten
            </h3>
            <ActivityTimeline activities={activities} />
          </div>
        </div>
      </div>

      {/* Modals */}
      {orderModalQuote && (
        <QuoteToOrderModal
          quote={orderModalQuote.quote}
          lead={lead}
          lineItems={orderModalQuote.lineItems}
          onClose={() => setOrderModalQuote(null)}
          onSuccess={() => {
            setOrderModalQuote(null);
            fetchData();
          }}
        />
      )}
      <AIQuoteAdvisor
        open={showAdvisor}
        onClose={() => setShowAdvisor(false)}
        leadId={params.id}
        formSubmissionId={data?.chatbot_submission_id}
        onCommitted={() => {
          setShowAdvisor(false);
          fetchData();
        }}
      />

      {isHipHot && (
        <HipHotQuoteBuilder
          open={showHipHotBuilder}
          onClose={() => { setShowHipHotBuilder(false); setEditHipHotQuoteId(null); }}
          lead={lead}
          editQuoteId={editHipHotQuoteId}
          onSaved={fetchData}
          onPublishedEmail={(quoteData) => {
            setEmailQuoteOverride(quoteData);
            setShowEmailCompose(quoteData.id);
          }}
        />
      )}
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
      {/* Email Compose Modal */}
      {showEmailCompose && (
        <EmailCompose
          open={!!showEmailCompose}
          onClose={() => { setShowEmailCompose(null); setEmailQuoteOverride(null); }}
          quoteId={showEmailCompose}
          defaultTo={lead.email}
          onSent={fetchData}
          lead={lead}
          quoteData={emailQuoteOverride || quotes.find((q) => q.id === showEmailCompose)}
        />
      )}
    </AppShell>
  );
}
