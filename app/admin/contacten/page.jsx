"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { ArrowLeft, Loader2, Search, Sparkles, Star } from "lucide-react";
import Link from "next/link";

const SUBSCRIPTION_FILTERS = [
  { value: "all", label: "Alle contacten" },
  { value: "receives", label: "Ontvangt nieuwsbrief" },
  { value: "not_receiving", label: "Ontvangt geen nieuwsbrief" },
];

const SUBSCRIPTION_LABELS = {
  subscribed: "Ingeschreven",
  unsubscribed: "Uitgeschreven",
  hard_bounce: "Hard bounce",
  non_marketing: "Geen marketing",
  unknown: "Onbekend",
};

function NewsletterBadge({ contact }) {
  if (contact.receives_newsletter) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-pill bg-green-50 text-green-700">Ontvangt</span>;
  }
  if (contact.email_suppressed) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-pill bg-red-50 text-red-600">Adres uitgeschreven</span>;
  }
  if (!contact.email) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-pill bg-gray-100 text-gray-500">Geen e-mail</span>;
  }
  return <span className="text-xs font-medium px-2 py-0.5 rounded-pill bg-gray-100 text-gray-500">Nee</span>;
}

const PROFILE_BADGES = {
  approved: { label: "Goedgekeurd", className: "bg-green-50 text-green-700" },
  draft: { label: "Concept", className: "bg-amber-50 text-amber-700" },
};

function ProfileBadge({ status }) {
  const badge = PROFILE_BADGES[status];
  if (!badge) return <span className="text-xs font-medium px-2 py-0.5 rounded-pill bg-gray-100 text-gray-500">Ontbreekt</span>;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-pill ${badge.className}`}>{badge.label}</span>;
}

export default function ContactenPage() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("receives");
  const [generating, setGenerating] = useState(null); // { done, total, failed }

  async function fetchContacts() {
    try {
      const res = await apiFetch("/api/contacts/overview");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setContacts(data.contacts || []);
    } catch (err) {
      setError(err.message || "Kon contacten niet laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchContacts();
  }, []);

  // Profielen voor ontvangende bedrijven zonder profiel, één voor één
  // (de API is per gebruiker begrensd en scrapet per bedrijf een website).
  const missingProfileLeadIds = [
    ...new Set(
      contacts
        .filter((contact) => contact.receives_newsletter && !contact.profile_status)
        .map((contact) => contact.lead_id)
    ),
  ];

  async function generateMissingProfiles() {
    const ids = missingProfileLeadIds;
    if (!ids.length) return;
    setError("");
    const failed = [];
    setGenerating({ done: 0, total: ids.length, failed: 0 });
    for (const [index, leadId] of ids.entries()) {
      try {
        const res = await apiFetch(`/api/leads/${leadId}/newsletter-profile`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failed.push(`${contacts.find((c) => c.lead_id === leadId)?.company_name}: ${data.error || res.status}`);
        }
      } catch (err) {
        failed.push(err.message);
      }
      setGenerating({ done: index + 1, total: ids.length, failed: failed.length });
    }
    if (failed.length) setError(`Niet gelukt voor ${failed.length} bedrijf/bedrijven: ${failed.join("; ")}`);
    setGenerating(null);
    await fetchContacts();
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (filter === "receives" && !contact.receives_newsletter) return false;
      if (filter === "not_receiving" && contact.receives_newsletter) return false;
      if (!needle) return true;
      return [contact.name, contact.email, contact.company_name, contact.role]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [contacts, query, filter]);

  const receivingCount = contacts.filter((contact) => contact.receives_newsletter).length;
  const receivingCompanies = new Set(
    contacts.filter((contact) => contact.receives_newsletter).map((contact) => contact.lead_id)
  ).size;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto py-8 px-4">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Terug
        </Link>

        <h1 className="text-xl font-bold mb-1">Contacten</h1>
        <p className="text-sm text-gray-500 mb-6">
          Alle contactpersonen met hun bedrijf. {receivingCount} contacten bij {receivingCompanies} bedrijven
          ontvangen de nieuwsbrief.
        </p>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl mb-4">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op naam, e-mail, bedrijf of functie"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
          >
            {SUBSCRIPTION_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            onClick={generateMissingProfiles}
            disabled={Boolean(generating) || missingProfileLeadIds.length === 0}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-40"
            title="Nieuwsbriefprofiel genereren voor ontvangende bedrijven zonder profiel"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating
              ? `Profielen ${generating.done}/${generating.total}`
              : `Genereer ontbrekende profielen (${missingProfileLeadIds.length})`}
          </button>
        </div>

        <div className="bg-white border border-gray-100 rounded-card overflow-x-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 p-5">
              <Loader2 className="w-4 h-4 animate-spin" />
              Laden...
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400 p-5">Geen contacten gevonden.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-4 py-3">Naam</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Functie</th>
                  <th className="px-4 py-3">Bedrijf</th>
                  <th className="px-4 py-3">Inschrijving bedrijf</th>
                  <th className="px-4 py-3">Nieuwsbrief</th>
                  <th className="px-4 py-3">Profiel</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((contact) => (
                  <tr key={contact.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-700">
                      <span className="inline-flex items-center gap-1.5">
                        {contact.name || "—"}
                        {contact.is_primary && <Star className="w-3.5 h-3.5 text-brand-amber" title="Primair contact" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{contact.email || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{contact.role || "—"}</td>
                    <td className="px-4 py-3">
                      <Link href={`/leads/${contact.lead_id}`} className="text-gray-700 hover:text-brand-amber hover:underline">
                        {contact.company_name || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {SUBSCRIPTION_LABELS[contact.marketing_subscription_status] || contact.marketing_subscription_status}
                    </td>
                    <td className="px-4 py-3"><NewsletterBadge contact={contact} /></td>
                    <td className="px-4 py-3"><ProfileBadge status={contact.profile_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
