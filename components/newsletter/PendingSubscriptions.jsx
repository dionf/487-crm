"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { relationLabel } from "@/lib/constants";

const PAGE_SIZE = 50;

// Nieuwsbrieven › Nog geen nieuwsbrief: bedrijven en adressen zonder vinkje,
// met per bedrijf de keuze welke adressen alsnog de nieuwsbrief krijgen.
export default function PendingSubscriptions({ tenant, onCountsChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(null);

  async function load() {
    setError("");
    try {
      const res = await apiFetch("/api/newsletter/pending");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json);
      onCountsChange?.({ companies: json.company_count, addresses: json.address_count });
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const companies = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = data?.companies || [];
    if (!term) return list;
    return list.filter((company) =>
      [company.company_name, ...company.addresses.flatMap((a) => [a.name, a.email])]
        .some((value) => String(value || "").toLowerCase().includes(term))
    );
  }, [data, search]);

  function toggle(companyId, email) {
    setSelected((current) => {
      const set = new Set(current[companyId] || []);
      if (set.has(email)) set.delete(email);
      else set.add(email);
      return { ...current, [companyId]: [...set] };
    });
  }

  function toggleAll(company) {
    setSelected((current) => {
      const all = company.addresses.map((a) => a.email);
      const allSelected = (current[company.id] || []).length === all.length;
      return { ...current, [company.id]: allSelected ? [] : all };
    });
  }

  async function act(company, action) {
    const emails = action === "subscribe" ? selected[company.id] || [] : company.addresses.map((a) => a.email);
    if (action === "decline" && !confirm(
      company.company_pending
        ? `${company.company_name} bewust geen nieuwsbrief sturen? Het bedrijf verdwijnt dan uit deze lijst.`
        : `${emails.join(", ")} bewust geen nieuwsbrief sturen?`
    )) return;
    setBusy(company.id);
    setError("");
    try {
      const res = await apiFetch("/api/newsletter/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: company.id, action, emails, company_pending: company.company_pending }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      if (json.blocked?.length) setError(`${json.blocked.join(", ")} is geblokkeerd na een bounce en is niet ingeschreven.`);
      setSelected((current) => ({ ...current, [company.id]: [] }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Nog geen nieuwsbrief</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {data
              ? `${data.company_count} bedrijven en ${data.address_count} adressen hebben nog geen nieuwsbriefvinkje.`
              : ""}{" "}
            Vink aan wie de nieuwsbrief alsnog mag krijgen. Stond het bedrijf nog uit, dan gaat het aan voor alleen de aangevinkte adressen.
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisible(PAGE_SIZE);
            }}
            placeholder="Zoek bedrijf, naam of e-mail"
            className="pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 outline-none focus:border-brand-amber w-64"
          />
        </div>
      </div>

      {error && <div className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

      {data && !companies.length && (
        <p className="text-sm text-gray-500 py-6 text-center">
          {search ? "Geen treffers." : "Iedereen heeft een nieuwsbriefkeuze. Niets te doen."}
        </p>
      )}

      <div className="divide-y divide-gray-100">
        {companies.slice(0, visible).map((company) => {
          const chosen = new Set(selected[company.id] || []);
          return (
            <div key={company.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Link href={`/leads/${company.id}`} className="font-medium text-brand-black hover:underline">
                    {company.company_name}
                  </Link>
                  {company.relationship_type && (
                    <span className="text-xs px-2 py-0.5 rounded-pill bg-gray-50 text-gray-600 border border-gray-100">
                      {relationLabel(tenant, company.relationship_type)}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-pill border ${
                    company.company_pending
                      ? "bg-amber-50 text-brand-orange border-amber-100"
                      : "bg-green-50 text-green-700 border-green-100"
                  }`}>
                    {company.company_pending ? "Bedrijf nog niet beslist" : "Bedrijf ontvangt al"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => act(company, "decline")}
                    disabled={busy === company.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-pill border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Geen nieuwsbrief
                  </button>
                  <button
                    type="button"
                    onClick={() => act(company, "subscribe")}
                    disabled={busy === company.id || !chosen.size}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-pill bg-brand-amber text-white hover:opacity-90 disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {busy === company.id ? "Bezig..." : `Inschrijven${chosen.size ? ` (${chosen.size})` : ""}`}
                  </button>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {company.addresses.length > 1 && (
                  <button
                    type="button"
                    onClick={() => toggleAll(company)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    {chosen.size === company.addresses.length ? "Niets selecteren" : "Alles selecteren"}
                  </button>
                )}
                {company.addresses.map((address) => (
                  <label key={address.email} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chosen.has(address.email)}
                      onChange={() => toggle(company.id, address.email)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-brand-black">{address.name}</span>
                    {address.role && <span className="text-gray-400">· {address.role}</span>}
                    <span className="text-gray-500">{address.email}</span>
                    {address.newsletter?.state === "no_consent" && (
                      <span className="text-xs text-brand-orange">nog geen toestemming</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {companies.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="w-full py-2 text-sm text-gray-500 hover:text-brand-black"
        >
          Meer tonen ({companies.length - visible} resterend)
        </button>
      )}
    </div>
  );
}
