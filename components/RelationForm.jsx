"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { getRelationTypes } from "@/lib/constants";

const inputClass = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber";

// Nieuw bedrijf buiten de salespipeline (klant, partner, alleen nieuwsbrief),
// met het eerste contact. Het contact ontstaat server-side uit de leadvelden.
export default function RelationForm({ onClose, onSaved }) {
  const { tenant } = useOrg();
  const relationTypes = getRelationTypes(tenant);
  const [form, setForm] = useState({
    company_name: "",
    website_url: "",
    relationship_type: relationTypes[0]?.id || "",
    contact_name: "",
    email: "",
    role: "",
    newsletter: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: form.company_name.trim(),
          website_url: form.website_url.trim() || null,
          relationship_type: form.relationship_type,
          in_pipeline: false,
          contact_person: form.contact_name.trim(),
          contact_function: form.role.trim() || null,
          email: form.email.trim(),
          source: "handmatig",
          marketing_consent: form.newsletter,
          marketing_subscription_status: form.newsletter ? "subscribed" : "non_marketing",
          marketing_consent_source: form.newsletter ? "handmatig" : null,
          marketing_consent_date: form.newsletter ? new Date().toISOString() : null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      onSaved?.(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto">
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-card p-5 mt-16 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Relatie toevoegen</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-700" aria-label="Sluiten">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Een bedrijf buiten de salespipeline. Het telt niet mee in dashboard en pipelinewaarde; je kunt het later alsnog een lead maken.
        </p>
        {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</div>}
        <input value={form.company_name} onChange={set("company_name")} placeholder="Bedrijfsnaam" required className={inputClass} />
        <input value={form.website_url} onChange={set("website_url")} placeholder="Website (optioneel)" className={inputClass} />
        <label className="block text-xs font-semibold text-gray-500 uppercase">
          Soort relatie
          <select value={form.relationship_type} onChange={set("relationship_type")} className={`${inputClass} mt-1 bg-white font-normal normal-case text-brand-black`}>
            {relationTypes.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </label>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase">Contact</p>
          <input value={form.contact_name} onChange={set("contact_name")} placeholder="Naam" className={`${inputClass} bg-white`} />
          <input type="email" value={form.email} onChange={set("email")} placeholder="E-mailadres" required className={`${inputClass} bg-white`} />
          <input value={form.role} onChange={set("role")} placeholder="Functie (optioneel)" className={`${inputClass} bg-white`} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.newsletter} onChange={set("newsletter")} className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber" />
          Ontvangt de nieuwsbrief (toestemming gegeven)
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-pill text-sm font-semibold text-gray-500 hover:text-brand-black">
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving || !form.company_name.trim() || !form.email.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Opslaan
          </button>
        </div>
      </form>
    </div>
  );
}
