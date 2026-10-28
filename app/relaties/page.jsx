"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2, Plus, Search, Sparkles, Star, UserPlus } from "lucide-react";
import AppShell from "@/components/AppShell";
import RelationForm from "@/components/RelationForm";
import NewsletterHistory, { historySummaryText } from "@/components/NewsletterHistory";
import { NEWSLETTER_STATE_LABELS, setCompanyNewsletter, setEmailNewsletter } from "@/components/newsletter/contactNewsletter";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { getLeadStatuses, getRelationTypes, relationLabel } from "@/lib/constants";

const PAGE_SIZE = 50;
const SCOPES = [
  { value: "all", label: "Alle bedrijven" },
  { value: "pipeline", label: "In pipeline" },
  { value: "relations", label: "Relaties (buiten pipeline)" },
];
const NEWSLETTER_FILTERS = [
  { value: "all", label: "Nieuwsbrief: alle" },
  { value: "receives", label: "Ontvangt nieuwsbrief" },
  { value: "not_receiving", label: "Ontvangt geen nieuwsbrief" },
  { value: "missing_profile", label: "Ontvangt, profiel ontbreekt" },
];
const PROFILE_BADGES = {
  approved: { label: "Profiel goedgekeurd", className: "bg-green-50 text-green-700" },
  draft: { label: "Profiel concept", className: "bg-amber-50 text-amber-700" },
};
const inputClass = "px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber";

function Checkbox({ checked, disabled, onChange, title }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      title={title}
      className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber disabled:opacity-40"
    />
  );
}

function ContactRow({ contact, busy, onToggle }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const state = NEWSLETTER_STATE_LABELS[contact.newsletter.state] || NEWSLETTER_STATE_LABELS.company_off;
  // Het vinkje gaat over het adres zelf; bij "bedrijf uit" staat het adres wel aan.
  const addressOn = !contact.newsletter.email_suppressed;

  async function toggleHistory() {
    setOpen(!open);
    if (entries || !contact.email) return;
    const res = await apiFetch(`/api/newsletter/history?email=${encodeURIComponent(contact.email)}`);
    const json = await res.json().catch(() => ({}));
    setEntries(Object.values(json.history || {})[0] || []);
  }

  return (
    <div className="px-3 py-2 border-t border-gray-50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Checkbox
          checked={addressOn && Boolean(contact.email)}
          disabled={busy || !contact.email}
          onChange={(value) => onToggle(contact, value)}
          title={addressOn ? "Dit adres uitschrijven" : "Dit adres weer inschrijven"}
        />
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium text-gray-700 inline-flex items-center gap-1.5">
            {contact.name || contact.email || "—"}
            {contact.is_primary && <Star className="w-3.5 h-3.5 text-brand-amber" title="Primair contact" />}
          </span>
          <span className="block text-xs text-gray-500 truncate">
            {[contact.email, contact.role].filter(Boolean).join(" · ") || "Geen e-mailadres"}
          </span>
        </span>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill border ${state.className}`} title={contact.newsletter.suppression?.reason || ""}>
          {state.short}
        </span>
        <button type="button" onClick={toggleHistory} className="text-xs text-gray-500 hover:text-brand-orange">
          {historySummaryText(contact.history)}
        </button>
      </div>
      {open && (
        <div className="ml-7 mt-2 rounded-xl bg-gray-50 px-3 py-2">
          <NewsletterHistory entries={entries} />
        </div>
      )}
    </div>
  );
}

function AddContactForm({ leadId, onSaved, onCancel }) {
  const [form, setForm] = useState({ name: "", email: "", role: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, name: form.name.trim(), email: form.email.trim() || null, role: form.role.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Contact toevoegen mislukt");
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="px-3 py-2 border-t border-gray-50 flex flex-wrap gap-2 items-center">
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Naam" required className={`${inputClass} flex-1 min-w-[140px]`} />
      <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="E-mail" className={`${inputClass} flex-1 min-w-[180px]`} />
      <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Functie" className={`${inputClass} w-32`} />
      <button type="submit" disabled={saving || !form.name.trim()} className="px-3 py-2 rounded-pill text-xs font-semibold text-white bg-brand-black disabled:opacity-50">
        {saving ? "Opslaan..." : "Toevoegen"}
      </button>
      <button type="button" onClick={onCancel} className="px-2 py-2 text-xs font-semibold text-gray-500">Annuleren</button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}

// Alle bedrijven met hun contacten, nieuwsbriefstatus, historie en handmatig
// uit-/inschrijven. Ook voor bedrijven buiten de salespipeline (relaties).
export default function RelatiesPage() {
  const { tenant } = useOrg();
  const statuses = getLeadStatuses(tenant);
  const relationTypes = getRelationTypes(tenant);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [relationType, setRelationType] = useState("");
  const [newsletterFilter, setNewsletterFilter] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());
  const [addingContactFor, setAddingContactFor] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [generating, setGenerating] = useState(null);

  async function load() {
    try {
      const res = await apiFetch("/api/relations");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Kon relaties niet laden");
      setCompanies(json.companies || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Alleen het geraakte bedrijf opnieuw laden, niet de hele lijst met historie.
  async function reloadCompany(companyId) {
    const res = await apiFetch(`/api/relations?lead_id=${companyId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Kon bedrijf niet verversen");
    const fresh = json.companies?.[0];
    if (fresh) setCompanies((current) => current.map((company) => (company.id === companyId ? fresh : company)));
  }

  async function run(key, companyId, action) {
    setBusy(key);
    setError("");
    try {
      await action();
      await reloadCompany(companyId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const toggleContact = (company, contact, subscribed) =>
    run(`contact-${contact.email}`, company.id, async () => {
      if (!subscribed && !confirm(`${contact.email} uitschrijven voor de nieuwsbrief?`)) return;
      await setEmailNewsletter(contact.email, subscribed);
    });

  const toggleCompany = (company, subscribed) =>
    run(`company-${company.id}`, company.id, async () => {
      if (!subscribed && !confirm(`${company.company_name} uitschrijven? Geen enkel adres van dit bedrijf ontvangt dan nog de nieuwsbrief.`)) return;
      await setCompanyNewsletter(company.id, subscribed, { hardBounced: company.hard_bounced });
    });

  function toggleExpanded(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return companies.filter((company) => {
      if (scope === "pipeline" && !company.in_pipeline) return false;
      if (scope === "relations" && company.in_pipeline) return false;
      if (relationType && company.relationship_type !== relationType) return false;
      if (newsletterFilter === "receives" && !company.receiving_count) return false;
      if (newsletterFilter === "not_receiving" && company.receiving_count) return false;
      if (newsletterFilter === "missing_profile" && (!company.receiving_count || company.profile_status)) return false;
      if (!needle) return true;
      return [company.company_name, ...company.contacts.flatMap((contact) => [contact.name, contact.email])]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [companies, query, scope, relationType, newsletterFilter]);

  const missingProfiles = companies.filter((company) => company.receiving_count && !company.profile_status);
  const receivingContacts = companies.reduce((sum, company) => sum + company.receiving_count, 0);
  const receivingCompanies = companies.filter((company) => company.receiving_count).length;

  // Eén voor één: de profiel-API is per gebruiker begrensd en scrapet per bedrijf.
  async function generateMissingProfiles() {
    const failed = [];
    setError("");
    for (const [index, company] of missingProfiles.entries()) {
      setGenerating({ done: index, total: missingProfiles.length });
      const res = await apiFetch(`/api/leads/${company.id}/newsletter-profile`, { method: "POST" }).catch(() => null);
      if (!res?.ok) {
        const json = await res?.json().catch(() => ({}));
        failed.push(`${company.company_name}: ${json?.error || "mislukt"}`);
      }
    }
    setGenerating(null);
    if (failed.length) setError(`Niet gelukt: ${failed.join("; ")}`);
    await load();
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">Relaties</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {companies.length} bedrijven · {receivingContacts} adressen bij {receivingCompanies} bedrijven ontvangen de nieuwsbrief
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={generateMissingProfiles}
            disabled={Boolean(generating) || !missingProfiles.length}
            className="flex items-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold border border-gray-200 bg-white hover:border-brand-amber disabled:opacity-40"
            title="Nieuwsbriefprofiel genereren voor ontvangende bedrijven zonder profiel"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? `Profielen ${generating.done + 1}/${generating.total}` : `Ontbrekende profielen (${missingProfiles.length})`}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black"
          >
            <Plus className="w-4 h-4" />
            Relatie toevoegen
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl mb-4">{error}</div>}

      <div className="flex flex-col lg:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_SIZE); }}
            placeholder="Zoek op bedrijf, naam of e-mail"
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <select value={scope} onChange={(e) => { setScope(e.target.value); setLimit(PAGE_SIZE); }} className={inputClass}>
          {SCOPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={relationType} onChange={(e) => { setRelationType(e.target.value); setLimit(PAGE_SIZE); }} className={inputClass}>
          <option value="">Soort: alle</option>
          {relationTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
        </select>
        <select value={newsletterFilter} onChange={(e) => { setNewsletterFilter(e.target.value); setLimit(PAGE_SIZE); }} className={inputClass}>
          {NEWSLETTER_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <div className="bg-white border border-gray-100 rounded-card">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 p-5">
            <Loader2 className="w-4 h-4 animate-spin" />
            Laden...
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-400 p-5">Geen bedrijven gevonden.</p>
        ) : (
          visible.slice(0, limit).map((company) => {
            const isOpen = expanded.has(company.id);
            const profile = PROFILE_BADGES[company.profile_status];
            return (
              <div key={company.id} className="border-b border-gray-100 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <button type="button" onClick={() => toggleExpanded(company.id)} className="text-gray-400" aria-label="Contacten tonen">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500" title="Bedrijf ingeschreven voor de nieuwsbrief">
                    <Checkbox
                      checked={company.newsletter_subscribed}
                      disabled={busy === `company-${company.id}`}
                      onChange={(value) => toggleCompany(company, value)}
                    />
                    Nieuwsbrief
                  </label>
                  <Link href={`/leads/${company.id}`} className="text-sm font-semibold text-gray-800 hover:text-brand-orange min-w-0 truncate">
                    {company.company_name}
                  </Link>
                  {company.relationship_type && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill bg-blue-50 text-blue-700 border border-blue-100">
                      {relationLabel(tenant, company.relationship_type)}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {company.in_pipeline ? statuses.find((status) => status.id === company.status)?.label || company.status : "Buiten pipeline"}
                  </span>
                  <span className="flex-1" />
                  {company.receiving_count > 0 && profile && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill ${profile.className}`}>{profile.label}</span>
                  )}
                  <button type="button" onClick={() => toggleExpanded(company.id)} className="text-xs text-gray-500">
                    {company.receiving_count}/{company.contacts.length} ontvangt · {company.newsletter_count} nieuwsbrieven
                  </button>
                </div>
                {isOpen && (
                  <div className="bg-gray-50/40 pb-1">
                    {company.contacts.length === 0 && (
                      <p className="px-3 py-2 border-t border-gray-50 text-xs text-gray-400">Nog geen contacten.</p>
                    )}
                    {company.contacts.map((contact) => (
                      <ContactRow
                        key={contact.contact_id || `company-${contact.email}`}
                        contact={contact}
                        busy={busy === `contact-${contact.email}`}
                        onToggle={(contactRow, value) => toggleContact(company, contactRow, value)}
                      />
                    ))}
                    {addingContactFor === company.id ? (
                      <AddContactForm
                        leadId={company.id}
                        onCancel={() => setAddingContactFor(null)}
                        onSaved={async () => { setAddingContactFor(null); await reloadCompany(company.id); }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingContactFor(company.id)}
                        className="ml-3 my-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-brand-orange"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Contact toevoegen
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {visible.length > limit && (
        <button
          type="button"
          onClick={() => setLimit(limit + PAGE_SIZE)}
          className="mt-3 w-full py-2 rounded-pill text-sm font-semibold border border-gray-200 bg-white hover:border-brand-amber"
        >
          Meer tonen ({visible.length - limit} over)
        </button>
      )}

      {showForm && (
        <RelationForm
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load(); }}
        />
      )}
    </AppShell>
  );
}
