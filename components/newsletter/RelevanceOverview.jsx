"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, Sparkles, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { confirmDialog, notify } from "@/components/Dialogs";
import { itemLinePlan } from "@/lib/newsletter-relevance";

const SCORE_LABELS = { sterk: "Sterk", mogelijk: "Mogelijk", niet: "Niet" };
const SCORE_DOTS = { sterk: "bg-green-500", mogelijk: "bg-brand-amber", niet: "bg-gray-300" };
const BATCH_SIZE = 5;

async function readJson(res, fallback) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || fallback);
  return json;
}

// Wat er in een vakje staat. Twijfel = de AI koos geen tekst terwijl het item
// wel (mogelijk of sterk) past: dat wil je nakijken.
function cellState(company, item) {
  const hasText = company.slots.some((slot) => slot.slot === `item:${item.id}` && slot.content?.text);
  const assessment = company.scores?.[item.id] || null;
  const generated = company.approval !== "missing";
  const doubt = generated && !hasText && (assessment?.score === "mogelijk" || assessment?.score === "sterk");
  return { hasText, assessment, generated, doubt };
}

function cellTitle(company, item, state, canGenerate) {
  const parts = [`${company.company_name} · ${item.title}`];
  if (state.assessment) {
    parts.push(`${SCORE_LABELS[state.assessment.score]}${state.assessment.reason ? `: ${state.assessment.reason}` : ""}`);
  } else if (state.generated) {
    parts.push("Geen score (gegenereerd vóór de relevantiescore)");
  }
  if (!state.generated) parts.push("Nog niet gegenereerd");
  else if (state.hasText) parts.push("Heeft een tekst. Klik om te bekijken.");
  else parts.push(canGenerate ? "Geen tekst. Klik om alleen deze tekst te schrijven." : "Geen tekst");
  return parts.join("\n");
}

// Overzicht bedrijven × items: per vakje of er een blok "Waarom dit
// interessant is" komt en welke score de AI gaf. Bij veel bedrijven kijk je
// met "Alleen twijfelgevallen" alleen de uitzonderingen na.
export default function RelevanceOverview({ campaign, items, companies, editable, disabled, onReload, onOpenCompany }) {
  const [busy, setBusy] = useState(""); // cel- of kolomsleutel
  const [fill, setFill] = useState(null); // { item, done, total }
  const [onlyDoubt, setOnlyDoubt] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/newsletter/campaigns/${campaign.id}`;
  const plan = itemLinePlan(campaign, items);
  const locked = disabled || Boolean(busy) || Boolean(fill);

  const states = new Map(
    companies.map((company) => [company.id, new Map(items.map((item) => [item.id, cellState(company, item)]))])
  );
  const doubtCount = companies.reduce(
    (sum, company) => sum + items.filter((item) => states.get(company.id).get(item.id).doubt).length,
    0
  );
  const rows = onlyDoubt
    ? companies.filter((company) => items.some((item) => states.get(company.id).get(item.id).doubt))
    : companies;
  const missingFor = (item) =>
    companies.filter((company) => {
      const state = states.get(company.id).get(item.id);
      return state.generated && !state.hasText && company.newsletter_profile;
    });

  async function generateCell(company, item) {
    setBusy(`${company.id}:${item.id}`);
    setError("");
    try {
      await readJson(
        await apiFetch(`${base}/personalizations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: company.id, slot: `item:${item.id}` }),
        }),
        "Tekst schrijven mislukt"
      );
      await onReload();
    } catch (err) {
      setError(`${company.company_name}: ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  // Ontbrekende teksten bij één item, in porties van een paar bedrijven.
  async function fillMissing(item, targets) {
    const failures = [];
    for (let index = 0; index < targets.length; index += BATCH_SIZE) {
      setFill({ item, done: index, total: targets.length });
      const chunk = targets.slice(index, index + BATCH_SIZE);
      try {
        const json = await readJson(
          await apiFetch(`${base}/personalizations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lead_ids: chunk.map((company) => company.id), slot: `item:${item.id}` }),
          }),
          "Teksten schrijven mislukt"
        );
        failures.push(...(json.failures || []));
      } catch (err) {
        failures.push(...chunk.map((company) => `${company.company_name}: ${err.message}`));
      }
    }
    setFill(null);
    if (failures.length) setError(failures.join(" · "));
    else notify(`Teksten bij "${item.title}" geschreven`, { type: "success" });
  }

  async function toggleForAll(item) {
    const turnOn = !item.personalize_all;
    setBusy(`col:${item.id}`);
    setError("");
    try {
      await readJson(
        await apiFetch(`${base}/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personalize_all: turnOn }),
        }),
        "Opslaan mislukt"
      );
    } catch (err) {
      setError(err.message);
      setBusy("");
      return;
    }
    setBusy("");
    const targets = turnOn ? missingFor(item) : [];
    if (
      targets.length &&
      (await confirmDialog({
        title: `Teksten bij "${item.title}" aanvullen?`,
        message: `Bij ${targets.length} ${targets.length === 1 ? "bedrijf ontbreekt" : "bedrijven ontbreekt"} nog een tekst bij dit item. Alleen die worden geschreven; bestaande teksten blijven staan.`,
        confirmLabel: "Nu schrijven",
        cancelLabel: "Later",
      }))
    ) {
      await fillMissing(item, targets);
    }
    await onReload();
  }

  async function fillColumn(item) {
    const targets = missingFor(item);
    if (!targets.length) return;
    await fillMissing(item, targets);
    await onReload();
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Overzicht bedrijven en items</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {plan.layout === "per_item"
              ? "Bij elk item komt een blok. De score laat zien hoe goed het past."
              : `De AI schrijft per bedrijf een blok bij items die sterk passen, maximaal ${plan.max}. Items op "Voor iedereen" krijgen altijd een blok.`}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={onlyDoubt} onChange={(e) => setOnlyDoubt(e.target.checked)} className="accent-brand-orange" />
          Alleen twijfelgevallen ({doubtCount})
        </label>
      </div>

      {plan.overflow && (
        <div className="flex gap-2 px-3 py-2 rounded-xl bg-amber-50 text-xs text-brand-orange">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {plan.forced.length} items staan op &quot;Voor iedereen&quot;, meer dan het maximum van {plan.max}. Die krijgen voorrang:
            elk bedrijf krijgt bij al deze items een blok en de AI kiest er geen andere bij. Verhoog het maximum in de instellingen of zet een item uit.
          </span>
        </div>
      )}
      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs">{error}</div>}
      {fill && (
        <p className="flex items-center gap-2 text-xs text-gray-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Teksten bij &quot;{fill.item.title}&quot;: {Math.min(fill.done + BATCH_SIZE, fill.total)}/{fill.total}
        </p>
      )}

      <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-100">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-gray-50 border-b border-r border-gray-100 px-2 py-2 text-left font-semibold text-gray-500 min-w-[180px]">
                Bedrijf
              </th>
              {items.map((item) => {
                const withText = companies.filter((company) => states.get(company.id).get(item.id).hasText).length;
                const missing = item.personalize_all ? missingFor(item).length : 0;
                return (
                  <th key={item.id} className="sticky top-0 z-20 bg-gray-50 border-b border-gray-100 px-2 py-2 text-left align-top font-normal w-32 min-w-[128px]">
                    <p className="font-semibold text-brand-black line-clamp-2" title={item.title}>{item.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{withText}/{companies.length} met tekst</p>
                    {editable && plan.layout === "combined" && (
                      <button
                        type="button"
                        onClick={() => toggleForAll(item)}
                        disabled={locked}
                        title={item.personalize_all ? "Staat aan: elk bedrijf krijgt een blok bij dit item. Klik om uit te zetten." : "Elk bedrijf een blok bij dit item"}
                        className={`mt-1.5 flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-semibold border disabled:opacity-50 ${
                          item.personalize_all
                            ? "bg-brand-amber border-brand-amber text-brand-black"
                            : "border-gray-200 bg-white text-gray-500 hover:border-brand-amber"
                        }`}
                      >
                        {busy === `col:${item.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                        Voor iedereen
                      </button>
                    )}
                    {!editable && item.personalize_all && <p className="mt-1 text-[10px] font-semibold text-brand-orange">Voor iedereen</p>}
                    {editable && missing > 0 && (
                      <button
                        type="button"
                        onClick={() => fillColumn(item)}
                        disabled={locked}
                        className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-brand-orange hover:underline disabled:opacity-50"
                      >
                        <Sparkles className="w-3 h-3" />
                        Vul aan ({missing})
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((company) => (
              <tr key={company.id}>
                <th className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 px-2 py-1 text-left font-normal">
                  <button type="button" onClick={() => onOpenCompany(company.id)} className="flex items-center gap-1.5 max-w-[200px] hover:text-brand-orange">
                    <span className="truncate">{company.company_name}</span>
                    {company.sample && <span className="shrink-0 text-[9px] font-bold uppercase text-blue-700">vb</span>}
                  </button>
                </th>
                {items.map((item) => {
                  const state = states.get(company.id).get(item.id);
                  const canGenerate = editable && state.generated && !state.hasText && Boolean(company.newsletter_profile);
                  const key = `${company.id}:${item.id}`;
                  return (
                    <td key={item.id} className="border-b border-gray-100 p-0.5">
                      <button
                        type="button"
                        onClick={() => (state.hasText || !canGenerate ? onOpenCompany(company.id) : generateCell(company, item))}
                        disabled={locked && !state.hasText}
                        title={cellTitle(company, item, state, canGenerate)}
                        className={`w-full h-7 flex items-center justify-center gap-1.5 rounded-md border text-[10px] font-semibold ${
                          state.hasText
                            ? "border-green-100 bg-green-50 text-green-700"
                            : state.doubt
                              ? "border-dashed border-brand-orange bg-amber-50 text-brand-orange"
                              : "border-transparent text-gray-300 hover:border-gray-200"
                        } ${canGenerate ? "hover:border-brand-orange" : ""}`}
                      >
                        {busy === key ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : state.hasText ? (
                          <Check className="w-3 h-3" />
                        ) : state.doubt ? (
                          "?"
                        ) : !state.generated ? (
                          "–"
                        ) : null}
                        {state.assessment && <span className={`w-2 h-2 rounded-full ${SCORE_DOTS[state.assessment.score]}`} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={items.length + 1} className="px-3 py-4 text-center text-gray-400">
                  {onlyDoubt ? "Geen twijfelgevallen." : "Geen bedrijven."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><Check className="w-3 h-3 text-green-700" />tekst</span>
        <span className="flex items-center gap-1"><span className="px-1 rounded border border-dashed border-brand-orange text-brand-orange font-semibold">?</span>twijfel: past, maar geen tekst</span>
        {Object.entries(SCORE_LABELS).map(([score, label]) => (
          <span key={score} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${SCORE_DOTS[score]}`} />{label.toLowerCase()}</span>
        ))}
        <span>Reden: houd de muis op een vakje. Klik op een leeg vakje om alleen die tekst te schrijven.</span>
      </div>
    </div>
  );
}
