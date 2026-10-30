"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Loader2, Save } from "lucide-react";
import { apiFetch } from "@/lib/api";
import ImageField from "@/components/newsletter/ImageField";

export const LAYOUT_OPTIONS = [
  { id: "combined", label: "Combinatie: intro-hook plus regel bij de 1-2 meest relevante items" },
  { id: "intro", label: "Alleen intro-hook bovenaan" },
  { id: "per_item", label: "Bij elk item een regel" },
];

const FIELDS = ["name", "subject", "preview_text", "headline", "hero_image_url", "intro_text", "personalization_layout"];
const EDITABLE_STATUSES = new Set(["draft", "tested", "failed"]);

const labelClass = "block text-xs font-semibold text-gray-500 uppercase";
const inputClass = "mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal normal-case text-brand-black focus:outline-none focus:border-brand-amber disabled:bg-gray-50";

function formFromCampaign(campaign) {
  return Object.fromEntries(
    FIELDS.map((field) => [field, campaign[field] || (field === "personalization_layout" ? "combined" : "")])
  );
}

// Alle vaste velden van een gepersonaliseerde campagne, altijd zichtbaar en
// direct te bewerken: naam, onderwerp, previewtekst, kop, kopbeeld, inleiding
// en opzet. De doelgroep staat er ter informatie bij.
export default function CampaignSettings({ campaign, targetNames = [], onSaved }) {
  const [form, setForm] = useState(() => formFromCampaign(campaign));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const editable = EDITABLE_STATUSES.has(campaign.status);

  // Alleen verversen als de opgeslagen instellingen zelf veranderden: een
  // testmail of itemwijziging elders mag ingetypte wijzigingen niet wissen.
  const persistedKey = JSON.stringify(formFromCampaign(campaign));
  useEffect(() => {
    setForm(JSON.parse(persistedKey));
  }, [campaign.id, persistedKey]);

  const dirty = FIELDS.some((field) => (form[field] || "") !== (formFromCampaign(campaign)[field] || ""));
  const layoutChanged = form.personalization_layout !== (campaign.personalization_layout || "combined");
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function save() {
    if (layoutChanged && !confirm("Een andere opzet wist alle gegenereerde personalisatie. Doorgaan?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onSaved?.(json.campaign);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Instellingen</h2>
        {editable && (
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy || !form.name.trim() || !form.subject.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-pill text-xs font-semibold text-white bg-brand-black disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? "Opgeslagen" : "Wijzigingen opslaan"}
          </button>
        )}
      </div>
      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      {!editable && <p className="text-xs text-gray-500">Deze campagne is verzonden of bezig en kan niet meer worden aangepast.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className={labelClass}>
            Interne campagnenaam
            <input value={form.name} onChange={set("name")} disabled={!editable} className={inputClass} />
          </label>
          <label className={labelClass}>
            Onderwerp
            <input value={form.subject} onChange={set("subject")} disabled={!editable} className={inputClass} />
            <span className="block mt-1 text-xs font-normal normal-case text-gray-500">
              Basis voor de onderwerpregel per bedrijf. [bedrijf] wordt vervangen door de bedrijfsnaam.
            </span>
          </label>
          <label className={labelClass}>
            Previewtekst
            <input value={form.preview_text} onChange={set("preview_text")} disabled={!editable} className={inputClass} />
          </label>
          <label className={labelClass}>
            Opzet
            <select value={form.personalization_layout} onChange={set("personalization_layout")} disabled={!editable} className={inputClass}>
              {LAYOUT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className={labelClass}>
            Doelgroep
            <p className="mt-1 text-sm font-normal normal-case text-brand-black">{targetNames.length ? targetNames.join(", ") : "—"}</p>
          </div>
        </div>
        <div className="space-y-3">
          <label className={labelClass}>
            Kop bovenaan
            <input
              value={form.headline}
              onChange={set("headline")}
              disabled={!editable}
              placeholder="Bijv. Wat AI deze maand *voor jullie* betekent"
              className={inputClass}
            />
            <span className="block mt-1 text-xs font-normal normal-case text-gray-500">Zet woorden tussen *sterretjes* voor het oranje accent.</span>
          </label>
          <div className={labelClass}>
            Kopbeeld
            <div className="mt-1">
              {editable ? (
                <ImageField value={form.hero_image_url} onChange={(url) => setForm((current) => ({ ...current, hero_image_url: url }))} />
              ) : form.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.hero_image_url} alt="" className="h-24 rounded-xl border border-gray-100 object-cover" />
              ) : (
                <p className="text-sm font-normal normal-case text-gray-400">Geen kopbeeld</p>
              )}
            </div>
          </div>
          <label className={labelClass}>
            Algemene inleiding (voor iedereen gelijk)
            <textarea value={form.intro_text} onChange={set("intro_text")} disabled={!editable} rows={4} className={inputClass} />
          </label>
        </div>
      </div>
      {editable && dirty && (
        <p className="text-xs text-brand-orange">Niet opgeslagen wijzigingen. Na een wijziging van onderwerp, kop, kopbeeld of inleiding stuur je opnieuw een testmail.</p>
      )}
    </div>
  );
}
