"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Code2, Loader2, Plus, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import AudienceFields from "@/components/newsletter/AudienceFields";
import { BatchFields, HtmlEditor, ScheduleField } from "@/components/newsletter/BroadcastFields";
import PersonalizedFields, { LayoutSelect } from "@/components/newsletter/PersonalizedFields";
import { apiFetch } from "@/lib/api";
import { campaignTargetIds } from "@/lib/newsletter-audience";
import { PERSONALIZED_SUBJECT_TEMPLATE } from "@/lib/newsletter-subject";
import { DEFAULT_MAX_ITEM_LINES } from "@/lib/newsletter-relevance";
import { useOrg } from "@/lib/org-context";

const TYPES = [
  {
    id: "broadcast",
    label: "Standaard (eigen HTML)",
    icon: Code2,
    text: "Eén mail voor iedereen. Je plakt de HTML, plant een tijd en kunt automatische batches gebruiken.",
  },
  {
    id: "personalized",
    label: "Gepersonaliseerd per bedrijf",
    icon: Sparkles,
    text: "Items in drie secties, met een eigen intro en \"waarom interessant\"-regels per bedrijf. Na het aanmaken voeg je de items toe en review je per bedrijf.",
  },
];

const inputClass = "w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber";

function emptyCampaign() {
  return {
    name: "",
    subject: "",
    preview_text: "",
    segment_id: "",
    included_segment_ids: [],
    excluded_segment_ids: [],
    recipient_limit: "",
    batch_mode: "automatic",
    batch_size: "100",
    batch_wait_hours: "4",
    max_bounce_rate: "0.02",
    max_complaint_rate: "0",
    max_failed_rate: "0.03",
    max_unsubscribe_rate: "0.05",
    scheduled_at: "",
    body_html: "",
    personalization_layout: "combined",
    max_item_lines: String(DEFAULT_MAX_ITEM_LINES),
    headline: "",
    intro_text: "",
    hero_image_url: "",
  };
}

// Gepersonaliseerd verstuurt (nog) in één keer en zonder planning; de HTML
// wordt per ontvanger opgebouwd. Het soort campagne ligt vast na aanmaken.
function campaignPayload(mode, form) {
  if (mode !== "personalized") {
    const { personalization_layout, max_item_lines, headline, intro_text, hero_image_url, ...rest } = form;
    return { ...rest, mode: "broadcast" };
  }
  const { body_html, scheduled_at, ...rest } = form;
  return { ...rest, mode, batch_mode: "single" };
}

// Nieuwe campagne op een eigen scherm: eerst het soort kiezen, dan de
// basisgegevens. Na aanmaken ga je verder op de campagnepagina.
export default function NieuweCampagnePage() {
  const router = useRouter();
  const { organization } = useOrg();
  const [mode, setMode] = useState("");
  const [form, setForm] = useState(emptyCampaign);
  const [segments, setSegments] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accent = organization?.theme?.accent || "#F5A623";
  const targetIds = campaignTargetIds(form);

  useEffect(() => {
    apiFetch("/api/newsletter/segments")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Kon segmenten niet laden");
        const list = json.segments || [];
        setSegments(list);
        // Eerste doelgroep alvast kiezen, zoals voorheen.
        const defaultTarget = list.find((segment) => !segment.default_excluded);
        if (defaultTarget) {
          setForm((current) => (
            campaignTargetIds(current).length
              ? current
              : { ...current, segment_id: defaultTarget.id, included_segment_ids: [defaultTarget.id] }
          ));
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  const set = (field) => (e) => {
    const value = e.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function createCampaign(e) {
    e.preventDefault();
    if (!mode) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/newsletter/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignPayload(mode, form)),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Campagne opslaan mislukt");
      router.push(`/admin/nieuwsbrieven/${json.campaign.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <Link href="/admin/nieuwsbrieven" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-black">
          <ArrowLeft className="w-4 h-4" />
          Alle nieuwsbrieven
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-brand-black">Nieuwe campagne</h1>
          <p className="text-sm text-gray-500 mt-0.5">Je maakt eerst een concept. Er wordt nog niets verstuurd.</p>
        </div>

        {error && <div className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Stap 1 · Soort</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {TYPES.map((type) => {
              const Icon = type.icon;
              const active = mode === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setMode(type.id)}
                  className={`text-left rounded-card border-2 p-4 bg-white transition-colors ${
                    active ? "border-brand-amber bg-amber-50/40" : "border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <p className="flex items-center gap-2 font-semibold text-brand-black">
                    <Icon className={`w-4 h-4 ${active ? "text-brand-orange" : "text-gray-400"}`} />
                    {type.label}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">{type.text}</p>
                </button>
              );
            })}
          </div>
        </div>

        {mode && (
          <form onSubmit={createCampaign}>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Stap 2 · Basisgegevens</p>
            <div className="bg-white border border-gray-100 rounded-card p-5">
              {!segments && !error ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[390px_1fr] gap-5 items-start">
                  <div className="space-y-3">
                    <input value={form.name} onChange={set("name")} placeholder="Interne campagnenaam" className={inputClass} />
                    {mode === "personalized" ? (
                      <p className="text-xs text-gray-500">Onderwerp staat vast: {PERSONALIZED_SUBJECT_TEMPLATE}.</p>
                    ) : (
                      <input value={form.subject} onChange={set("subject")} placeholder="Titel / onderwerp" className={inputClass} />
                    )}
                    <input value={form.preview_text} onChange={set("preview_text")} placeholder="Previewtekst" className={inputClass} />
                    {mode === "broadcast" && <ScheduleField form={form} setForm={setForm} />}
                    <AudienceFields segments={segments || []} form={form} setForm={setForm} />
                    {mode === "broadcast" && <BatchFields form={form} setForm={setForm} />}
                  </div>
                  <div className="space-y-3">
                    {mode === "personalized" ? (
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                        <p className="text-sm text-gray-600">
                          De mail wordt per bedrijf opgebouwd uit items in drie secties, met een eigen onderwerpregel,
                          intro en &quot;waarom interessant&quot;-regels. Na het aanmaken voeg je de items toe en review je de
                          personalisatie per bedrijf. Verzenden gaat in één keer, zonder planning.
                        </p>
                        <LayoutSelect form={form} setForm={setForm} />
                        <PersonalizedFields form={form} setForm={setForm} />
                      </div>
                    ) : (
                      <HtmlEditor
                        value={form.body_html}
                        onChange={(value) => setForm((current) => ({ ...current, body_html: value }))}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <Link
                href="/admin/nieuwsbrieven"
                className="px-4 py-2 rounded-pill text-sm font-semibold border border-gray-200 bg-white hover:border-brand-amber"
              >
                Annuleren
              </Link>
              <button
                type="submit"
                disabled={busy || !segments || !targetIds.length}
                className="flex items-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: accent }}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Concept aanmaken
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
