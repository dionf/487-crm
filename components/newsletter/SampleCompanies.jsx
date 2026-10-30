"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

// Voorbeeldbedrijven: maak een versie voor een bedrijf dat niet in de
// doelgroep zit (bijv. een klant waar een collega aan werkt), om als testmail
// of preview-link te delen. Ze worden nooit echt verzonden.
export default function SampleCompanies({ campaign, editable, onChanged }) {
  const [companies, setCompanies] = useState([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const sampleIds = useMemo(() => campaign.sample_lead_ids || [], [campaign.sample_lead_ids]);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/newsletter/campaigns/${campaign.id}/samples`)
      .then((res) => res.json())
      .then((json) => !cancelled && setCompanies(json.companies || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaign.id]);

  async function change(body, key) {
    setBusy(key);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}/samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setSelected("");
      await onChanged(json.campaign);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const byId = new Map(companies.map((company) => [company.id, company]));
  const available = companies.filter((company) => !sampleIds.includes(company.id));

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase">Voorbeeldbedrijven</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Een versie voor een bedrijf buiten de doelgroep, om als testmail of link te delen. Wordt nooit verzonden.
        </p>
      </div>
      {sampleIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sampleIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-pill bg-white border border-gray-200 text-xs font-semibold">
              {byId.get(id)?.company_name || "Bedrijf"}
              {editable && (
                <button
                  type="button"
                  onClick={() => change({ remove: id }, `remove-${id}`)}
                  disabled={Boolean(busy)}
                  className="p-0.5 rounded-full text-gray-400 hover:text-red-600"
                  aria-label="Voorbeeldbedrijf weghalen"
                >
                  {busy === `remove-${id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {editable && (
        <div className="flex gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 min-w-0 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber"
          >
            <option value="">Kies een bedrijf...</option>
            {available.map((company) => (
              <option key={company.id} value={company.id}>
                {company.company_name}
                {company.newsletter_profile_status ? "" : " (nog geen profiel)"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => change({ add: selected }, "add")}
            disabled={!selected || Boolean(busy)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 bg-white hover:border-brand-amber disabled:opacity-50"
          >
            {busy === "add" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Toevoegen
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
