"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronDown, ChevronRight, EyeOff, Eye, Loader2, RotateCcw, Save, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import CompanyLogo from "@/components/CompanyLogo";
import RelevanceOverview from "@/components/newsletter/RelevanceOverview";
import { confirmDialog } from "@/components/Dialogs";
import { canSkipSlot } from "@/lib/newsletter-relevance";

const APPROVAL_BADGES = {
  approved: { label: "Goedgekeurd", className: "bg-green-50 text-green-700 border-green-100" },
  draft: { label: "Te reviewen", className: "bg-amber-50 text-brand-orange border-amber-100" },
  missing: { label: "Nog niet gegenereerd", className: "bg-gray-50 text-gray-500 border-gray-100" },
};

const FIXED_SLOTS = [
  // Oud slot van vóór het vaste onderwerp; verdwijnt bij Alles vernieuwen.
  { slot: "subject", label: "Onderwerpregel (oud, vervalt bij Alles vernieuwen)" },
  { slot: "preheader", label: "Preheader" },
  { slot: "intro", label: "Intro: In deze nieuwsbrief voor ..." },
];

// Bedrijven per request bij bulkgenereren (server staat er maximaal 5 toe).
// Een volledige generatie is zwaar; met 3 parallel blijft een request ruim
// binnen de 60 s en 50 bedrijven binnen de rate limit (17 requests).
const BATCH_SIZE = 3;
// Hoe vaak een portie na een 429 opnieuw wordt geprobeerd.
const RATE_LIMIT_RETRIES = 2;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function SlotEditor({ slot, editable, busy, regenerating, onSaveText, onStatus, onRegenerate }) {
  const [text, setText] = useState(slot.content?.text || "");
  const dirty = text.trim() !== (slot.content?.text || "").trim();
  const approved = slot.status === "approved";
  const skipped = slot.status === "skipped";

  if (skipped) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-gray-400 uppercase line-through">{slot.label}</p>
          <span className="flex items-center gap-1 text-xs font-semibold text-gray-500"><EyeOff className="w-3.5 h-3.5" />Weggelaten</span>
        </div>
        <p className="text-sm text-gray-400 line-through whitespace-pre-line">{slot.content?.text}</p>
        <p className="text-xs text-gray-500">Dit blok staat niet in de mail van dit bedrijf. Het item zelf blijft staan, en opnieuw genereren zet het blok niet terug.</p>
        {editable && (
          <button
            type="button"
            onClick={() => onStatus("draft")}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 bg-white text-gray-600 hover:border-brand-amber disabled:opacity-50"
          >
            <Eye className="w-3.5 h-3.5" />
            Toch tonen
          </button>
        )}
      </div>
    );
  }

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
        <div className="flex flex-wrap gap-2">
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
              onClick={() => onStatus(approved ? "draft" : "approved")}
              disabled={busy}
              title={approved ? "De tekst blijft in de mail, maar moet opnieuw worden nagekeken" : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border disabled:opacity-50 ${
                approved ? "border-gray-200 text-gray-500 hover:text-brand-black" : "border-green-200 text-green-700 hover:bg-green-50"
              }`}
            >
              {approved ? <RotateCcw className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
              {approved ? "Terug naar concept" : "Goedkeuren"}
            </button>
          )}
          {slot.slot !== "subject" && <button
            type="button"
            onClick={async () => {
              if (dirty && !(await confirmDialog({
                title: "Tekst vernieuwen?",
                message: "Je niet-opgeslagen wijziging gaat verloren.",
                confirmLabel: "Toch vernieuwen",
                danger: true,
              }))) return;
              if (!dirty && approved && !(await confirmDialog({
                title: "Goedgekeurde tekst vervangen?",
                message: "Deze tekst is goedgekeurd. Er komt een nieuwe versie voor in de plaats, die weer concept wordt.",
                confirmLabel: "Vernieuwen",
              }))) return;
              onRegenerate();
            }}
            disabled={busy}
            title="Alleen deze tekst opnieuw laten schrijven"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 text-gray-600 hover:border-brand-amber disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Vernieuwen
          </button>}
          {canSkipSlot(slot.slot) && (
            <button
              type="button"
              onClick={() => onStatus("skipped")}
              disabled={busy}
              title="Dit blok niet in de mail van dit bedrijf zetten; het item zelf blijft staan"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 text-gray-500 hover:text-brand-black disabled:opacity-50"
            >
              <EyeOff className="w-3.5 h-3.5" />
              Weglaten
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Per ontvangend bedrijf: profiel naast de gegenereerde teksten, bewerken,
// (opnieuw) genereren en goedkeuren.
export default function PersonalizationReview({ campaign, editable, data, items, onReload }) {
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const [bulk, setBulk] = useState(null); // { done, chunk, total, current, waiting? }
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

  const generate = async (company) => {
    if (company.approval !== "missing" && !(await confirmDialog({
      title: `Alle teksten van ${company.company_name} opnieuw laten schrijven?`,
      message: "Bewerkingen en goedkeuringen vervallen; weggelaten blokken blijven weggelaten. Wil je één tekst vernieuwen, gebruik dan Vernieuwen bij dat blok.",
      confirmLabel: "Alles opnieuw schrijven",
      danger: true,
    }))) return;
    run(`generate-${company.id}`, () => request("POST", { lead_id: company.id }, "Genereren mislukt"));
  };
  const approveAll = (company) => run(`approve-${company.id}`, () => request("PATCH", { lead_id: company.id, approve_all: true }, "Goedkeuren mislukt"));
  const saveText = (company, slot, text) => run(`slot-${slot.id}`, () => request("PATCH", { lead_id: company.id, slot: slot.slot, text }, "Opslaan mislukt"));
  const regenerateSlot = (company, slot) =>
    run(`regen-${slot.id}`, () => request("POST", { lead_id: company.id, slot: slot.slot }, "Vernieuwen mislukt"));
  const setStatus = (company, slot, status) => run(`slot-${slot.id}`, () => request(
    "PATCH",
    { lead_id: company.id, slot: slot.slot, status },
    "Status wijzigen mislukt"
  ));

  // Eén portie bedrijven in één request. Raakt de rate limit toch (bv. door
  // andere acties tussendoor), dan wachten we tot de teller weer ruimte heeft.
  async function generateBatch(chunk, onWait) {
    for (let attempt = 0; ; attempt += 1) {
      const res = await apiFetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_ids: chunk.map((company) => company.id) }),
      });
      if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return readJson(res, "Genereren mislukt");
      const json = await res.json().catch(() => ({}));
      const seconds = Math.min(Math.max(Number(json.retry_after) || 60, 5), 300);
      onWait(seconds);
      await wait(seconds * 1000);
    }
  }

  // In porties van een paar bedrijven, zodat elke call binnen de timeout en de
  // rate limit blijft, ook bij 50+ bedrijven.
  async function generateMany(onlyMissing) {
    const targets = companies.filter((company) => company.newsletter_profile && (!onlyMissing || company.approval === "missing"));
    if (!targets.length) return;
    if (!onlyMissing && !(await confirmDialog({
      title: `Personalisatie voor ${targets.length} bedrijven opnieuw genereren?`,
      message: "Bestaande teksten en goedkeuringen worden vervangen; weggelaten blokken blijven weggelaten.",
      confirmLabel: "Opnieuw genereren",
      danger: true,
    }))) return;
    setError("");
    const failures = [];
    for (let index = 0; index < targets.length; index += BATCH_SIZE) {
      const chunk = targets.slice(index, index + BATCH_SIZE);
      const status = { done: index, chunk: chunk.length, total: targets.length, current: chunk.map((company) => company.company_name).join(", ") };
      setBulk(status);
      try {
        const json = await generateBatch(chunk, (seconds) => setBulk({ ...status, waiting: seconds }));
        failures.push(...(json.failures || []));
      } catch (err) {
        // De hele portie faalde (bv. timeout); een deel kan toch gelukt zijn.
        failures.push(`${status.current}: ${err.message} (controleer of ze toch gegenereerd zijn)`);
      }
    }
    setBulk(null);
    if (failures.length) setError(`Niet alles is gelukt: ${failures.join(" · ")}`);
    await onReload();
  }

  if (!data) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  const openCompany = (companyId) => {
    setOpen(companyId);
    requestAnimationFrame(() => document.getElementById(`company-${companyId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
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
            {bulk.waiting
              ? `Even wachten op de limiet van de server (ca. ${bulk.waiting} s), daarna verder met ${bulk.current}`
              : `Bezig met ${bulk.current} (${bulk.done + 1}–${bulk.done + bulk.chunk} van ${bulk.total})`}
          </p>
        )}
        {!items.length && <p className="text-xs text-brand-orange">Voeg eerst items toe op het tabblad Inhoud.</p>}
      </div>

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

      {companies.length > 0 && items.length > 0 && (campaign.personalization_layout || "combined") !== "intro" && (
        <RelevanceOverview
          campaign={campaign}
          items={items}
          companies={companies}
          editable={editable}
          disabled={Boolean(bulk) || Boolean(busy)}
          onReload={onReload}
          onOpenCompany={openCompany}
        />
      )}

      <div className="space-y-2">
        {companies.map((company) => {
          const isOpen = open === company.id;
          const badge = APPROVAL_BADGES[company.approval] || APPROVAL_BADGES.missing;
          const slots = orderedSlots(company, items);
          return (
            <div key={company.id} id={`company-${company.id}`} className="rounded-xl border border-gray-100 scroll-mt-4">
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
                  <span className="text-xs text-gray-400 shrink-0">{company.recipients.length} ontv.</span>
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
                    <div className="rounded-xl bg-gray-50 p-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Ontvangers</p>
                      {company.recipients.map((recipient) => (
                        <p key={recipient.email} className="text-xs text-gray-600 truncate">{recipient.name || recipient.email}</p>
                      ))}
                    </div>
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
                        onStatus={(status) => setStatus(company, slot, status)}
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
