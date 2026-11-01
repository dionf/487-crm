"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Loader2, Save } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { EDITABLE_STATUSES } from "@/lib/newsletter-status";
import PersonalizedFields, { LayoutSelect, inputClass, labelClass } from "@/components/newsletter/PersonalizedFields";
import { personalizedSubject } from "@/lib/newsletter-subject";

const FIELDS = ["name", "preview_text", "headline", "hero_image_url", "intro_text", "personalization_layout"];

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
            disabled={!dirty || busy || !form.name.trim()}
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
          <div className={labelClass}>
            Onderwerp
            <p className="mt-1 text-sm font-normal normal-case text-brand-black">{personalizedSubject(campaign, "[bedrijf]")}</p>
            <span className="block mt-1 text-xs font-normal normal-case text-gray-500">
              Vast onderwerp: het weeknummer komt van de verzenddatum (anders vandaag), [bedrijf] wordt de bedrijfsnaam.
            </span>
          </div>
          <label className={labelClass}>
            Previewtekst
            <input value={form.preview_text} onChange={set("preview_text")} disabled={!editable} className={inputClass} />
          </label>
          <LayoutSelect form={form} setForm={setForm} disabled={!editable} />
          <div className={labelClass}>
            Doelgroep
            <p className="mt-1 text-sm font-normal normal-case text-brand-black">{targetNames.length ? targetNames.join(", ") : "—"}</p>
          </div>
        </div>
        <div className="space-y-3">
          <PersonalizedFields form={form} setForm={setForm} disabled={!editable} />
        </div>
      </div>
      {editable && dirty && (
        <p className="text-xs text-brand-orange">Niet opgeslagen wijzigingen. Na een wijziging van onderwerp, kop, kopbeeld of inleiding stuur je opnieuw een testmail.</p>
      )}
    </div>
  );
}
