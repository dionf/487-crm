"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, RotateCcw, Save, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import CompanyLogo from "@/components/CompanyLogo";
import SampleCompanies from "@/components/newsletter/SampleCompanies";

const APPROVAL_BADGES = {
  approved: { label: "Goedgekeurd", className: "bg-green-50 text-green-700 border-green-100" },
  draft: { label: "Te reviewen", className: "bg-amber-50 text-brand-orange border-amber-100" },
  missing: { label: "Nog niet gegenereerd", className: "bg-gray-50 text-gray-500 border-gray-100" },
};

const FIXED_SLOTS = [
  { slot: "subject", label: "Onderwerpregel" },
  { slot: "preheader", label: "Preheader" },
  { slot: "intro", label: "Intro: In deze nieuwsbrief voor ..." },
];

async function readJson(res, fallback) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || fallback);
  return json;
}

function orderedSlots(company, items) {
  const bySlot = new Map(company.slots.map((slot) => [slot.slot, slot]));
  const rows = FIXED_SLOTS.filter(({ slot }) => bySlot.has(slot)).map(({ slot, label }) => ({ ...bySlot.get(slot), label }));
  for (const item of items) {
    const slot = bySlot.get(`item:${item.id}`);
    if (slot) rows.push({ ...slot, label: `Waarom interessant: ${item.title}` });
  }
  return rows;
}

function SlotEditor({ slot, editable, busy, regenerating, onSaveText, onToggle, onRegenerate }) {
  const [text, setText] = useState(slot.content?.text || "");
  const dirty = text.trim() !== (slot.content?.text || "").trim();
  const approved = slot.status === "approved";

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${approved ? "border-green-100 bg-green-50/30" : "border-gray-100 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-gray-500 uppercase">{slot.label}</p>
        {approved && <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><Check className="w-3.5 h-3.5" />Akkoord</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!editable}
        rows={slot.slot === "subject" || slot.slot === "preheader" ? 1 : 3}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
      />
      {editable && (
        <div className="flex gap-2">
          {dirty ? (
            <button
              type="button"
              onClick={() => onSaveText(text)}
              disabled={busy || !text.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold text-white bg-brand-black disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              Tekst opslaan
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              disabled={busy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border disabled:opacity-50 ${
                approved ? "border-gray-200 text-gray-500 hover:text-brand-black" : "border-green-200 text-green-700 hover:bg-green-50"
              }`}
            >
              {approved ? <RotateCcw className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
              {approved ? "Terug naar concept" : "Goedkeuren"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (dirty && !confirm("Je niet-opgeslagen wijziging gaat verloren. Toch vernieuwen?")) return;
              onRegenerate();
            }}
            disabled={busy}
            title="Alleen deze tekst opnieuw laten schrijven"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 text-gray-600 hover:border-brand-amber disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Vernieuwen
          </button>
        </div>
      )}
    </div>
  );
}

// Per ontvangend bedrijf: profiel naast de gegenereerde teksten, bewerken,
// (opnieuw) genereren en goedkeuren.
export default function PersonalizationReview({ campaign, editable, data, items, onReload, onCampaignChange }) {
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const [bulk, setBulk] = useState(null); // { done, total, current }
  const [error, setError] = useState("");
  const base = `/api/newsletter/campaigns/${campaign.id}/personalizations`;
  const companies = data?.companies || [];
  const progress = data?.progress || { approved: 0, total: 0 };
  const percentage = progress.total ? Math.round((progress.approved / progress.total) * 100) : 0;

  async function request(method, body, fallback) {
    return readJson(
      await apiFetch(base, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      fallback
    );
  }

  async function run(key, action) {
    setBusy(key);
    setError("");
    try {
      await action();
      await onReload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const generate = (company) => {
    if (company.approval !== "missing" && !confirm(`Alle teksten van ${company.company_name} opnieuw laten schrijven? Bewerkingen en goedkeuringen vervallen. Wil je één tekst vernieuwen, gebruik dan Vernieuwen bij dat blok.`)) return;
    run(`generate-${company.id}`, () => request("POST", { lead_id: company.id }, "Genereren mislukt"));
  };
  const approveAll = (company) => run(`approve-${company.id}`, () => request("PATCH", { lead_id: company.id, approve_all: true }, "Goedkeuren mislukt"));
  const saveText = (company, slot, text) => run(`slot-${slot.id}`, () => request("PATCH", { lead_id: company.id, slot: slot.slot, text }, "Opslaan mislukt"));
  const regenerateSlot = (company, slot) =>
    run(`regen-${slot.id}`, () => request("POST", { lead_id: company.id, slot: slot.slot }, "Vernieuwen mislukt"));
  const toggle = (company, slot) => run(`slot-${slot.id}`, () => request(
    "PATCH",
    { lead_id: company.id, slot: slot.slot, status: slot.status === "approved" ? "draft" : "approved" },
    "Status wijzigen mislukt"
  ));

  // Eén request per bedrijf, zodat elke call binnen de serverlimiet blijft.
  async function generateMany(onlyMissing) {
    const targets = companies.filter((company) => company.newsletter_profile && (!onlyMissing || company.approval === "missing"));
    if (!targets.length) return;
    if (!onlyMissing && !confirm(`Personalisatie voor ${targets.length} bedrijven opnieuw genereren? Bestaande teksten en goedkeuringen worden vervangen.`)) return;
    setError("");
    const failures = [];
    for (const [index, company] of targets.entries()) {
      setBulk({ done: index, total: targets.length, current: company.company_name });
      try {
        await request("POST", { lead_id: company.id }, "Genereren mislukt");
      } catch (err) {
        failures.push(`${company.company_name}: ${err.message}`);
      }
    }
    setBulk(null);
    if (failures.length) setError(failures.join(" · "));
    await onReload();
  }

  if (!data) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  const withoutProfile = companies.filter((company) => !company.newsletter_profile);
  const missingCount = companies.filter((company) => company.approval === "missing" && company.newsletter_profile).length;

  return (
    <div className="space-y-4">
      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">{progress.approved}/{progress.total} bedrijven goedgekeurd</span>
          <span className="text-xs text-gray-500">{companies.reduce((sum, company) => sum + company.recipients.length, 0)} ontvangers</span>
        </div>
        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-green-500 transition-all" style={{ width: `${percentage}%` }} />
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => generateMany(true)}
              disabled={Boolean(bulk) || !missingCount || !items.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold text-white bg-brand-black disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Genereer ontbrekende ({missingCount})
            </button>
            <button
              type="button"
              onClick={() => generateMany(false)}
              disabled={Boolean(bulk) || !companies.length || !items.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 hover:border-brand-amber disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Alles opnieuw
            </button>
          </div>
        )}
        {bulk && (
          <p className="flex items-center gap-2 text-xs text-gray-600">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Bezig met {bulk.current} ({bulk.done + 1}/{bulk.total})
          </p>
        )}
        {!items.length && <p className="text-xs text-brand-orange">Voeg eerst items toe op het tabblad Inhoud.</p>}
      </div>

      <SampleCompanies
        campaign={campaign}
        editable={editable}
        recipientIds={companies.filter((company) => !company.sample).map((company) => company.id)}
        onChanged={async (updated) => {
          if (updated) onCampaignChange?.(updated);
          await onReload();
        }}
      />

      {withoutProfile.length > 0 && (
        <div className="flex gap-2 px-3 py-2 rounded-xl bg-amber-50 text-sm text-brand-orange">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Zonder nieuwsbriefprofiel kan niet worden gepersonaliseerd:{" "}
            {withoutProfile.map((company, index) => (
              <span key={company.id}>
                {index > 0 && ", "}
                <Link href={`/leads/${company.id}`} className="underline">{company.company_name}</Link>
              </span>
            ))}
            . Maak het profiel aan via het bedrijf of via Beheer › Contacten.
          </span>
        </div>
      )}

      {companies.length === 0 && <p className="text-sm text-gray-500">Deze campagne heeft geen ontvangers in de gekozen doelgroep.</p>}

      <div className="space-y-2">
        {companies.map((company) => {
          const isOpen = open === company.id;
          const badge = APPROVAL_BADGES[company.approval] || APPROVAL_BADGES.missing;
          const slots = orderedSlots(company, items);
          return (
            <div key={company.id} className="rounded-xl border border-gray-100">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : company.id)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  {company.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={company.logo_url} alt="" className="h-5 max-w-16 object-contain shrink-0" />
                  )}
                  <span className="text-sm font-semibold truncate">{company.company_name}</span>
                  {company.sample ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill bg-blue-50 text-blue-700 border border-blue-100">Voorbeeld</span>
                  ) : (
                    <span className="text-xs text-gray-400 shrink-0">{company.recipients.length} ontv.</span>
                  )}
                </span>
                <span className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill border ${badge.className}`}>{badge.label}</span>
              </button>
              {isOpen && (
                <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 px-3 pb-3">
                  <div className="space-y-2">
                    <div className="rounded-xl bg-gray-50 p-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Logo</p>
                      <CompanyLogo
                        leadId={company.id}
                        logoUrl={company.logo_url}
                        websiteUrl={company.website_url}
                        size="sm"
                        onChange={() => onReload()}
                      />
                      {!company.logo_url && <p className="text-xs text-gray-500 mt-1">Zonder logo toont de mail alleen de naam.</p>}
                    </div>
                    <div className="rounded-xl bg-gray-50 p-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Profiel</p>
                      <p className="text-xs text-gray-600 whitespace-pre-line">{company.newsletter_profile || "Geen profiel"}</p>
                      {company.newsletter_profile_status !== "approved" && company.newsletter_profile && (
                        <p className="text-xs text-brand-orange mt-2">Profiel is nog concept.</p>
                      )}
                      <Link href={`/leads/${company.id}`} className="inline-block text-xs text-brand-orange underline mt-2">Bedrijf openen</Link>
                    </div>
                    {!company.sample && (
                    <div className="rounded-xl bg-gray-50 p-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Ontvangers</p>
                      {company.recipients.map((recipient) => (
                        <p key={recipient.email} className="text-xs text-gray-600 truncate">{recipient.name || recipient.email}</p>
                      ))}
                    </div>
                    )}
                    {editable && (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => generate(company)}
                          disabled={Boolean(busy) || Boolean(bulk) || !company.newsletter_profile || !items.length}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 hover:border-brand-amber disabled:opacity-50"
                        >
                          {busy === `generate-${company.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          {company.approval === "missing" ? "Genereren" : "Alles vernieuwen"}
                        </button>
                        {company.approval === "draft" && (
                          <button
                            type="button"
                            onClick={() => approveAll(company)}
                            disabled={Boolean(busy)}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold text-white bg-green-600 disabled:opacity-50"
                          >
                            {busy === `approve-${company.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Alles goedkeuren
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    {slots.length === 0 ? (
                      <p className="text-sm text-gray-400 py-4">Nog geen teksten. Klik op Genereren.</p>
                    ) : slots.map((slot) => (
                      <SlotEditor
                        key={`${slot.id}-${slot.updated_at}`}
                        slot={slot}
                        editable={editable}
                        busy={Boolean(busy) || Boolean(bulk)}
                        regenerating={busy === `regen-${slot.id}`}
                        onSaveText={(text) => saveText(company, slot, text)}
                        onToggle={() => toggle(company, slot)}
                        onRegenerate={() => regenerateSlot(company, slot)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
