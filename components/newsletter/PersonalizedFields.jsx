"use client";

import ImageField from "@/components/newsletter/ImageField";
import { MAX_ITEM_LINES_LIMIT } from "@/lib/newsletter-relevance";

export const LAYOUT_OPTIONS = [
  { id: "combined", label: "Combinatie: intro-hook plus regel bij de items die sterk passen" },
  { id: "intro", label: "Alleen intro-hook bovenaan" },
  { id: "per_item", label: "Bij elk item een regel" },
];

export const labelClass = "block text-xs font-semibold text-gray-500 uppercase";
export const inputClass = "mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal normal-case text-brand-black focus:outline-none focus:border-brand-amber disabled:bg-gray-50";

function setter(setForm, field) {
  return (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };
}

// Opzet van de personalisatie: waar de regels per bedrijf komen. Bij de
// combinatie hoort het maximum aantal blokken "Waarom dit interessant is".
export function LayoutSelect({ form, setForm, disabled = false }) {
  return (
    <>
      <label className={labelClass}>
        Opzet
        <select value={form.personalization_layout} onChange={setter(setForm, "personalization_layout")} disabled={disabled} className={inputClass}>
          {LAYOUT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      {form.personalization_layout === "combined" && (
        <label className={labelClass}>
          Maximum blokken per bedrijf
          <input
            type="number"
            min={0}
            max={MAX_ITEM_LINES_LIMIT}
            value={form.max_item_lines}
            onChange={setter(setForm, "max_item_lines")}
            disabled={disabled}
            className={`${inputClass} max-w-[120px]`}
          />
          <span className="block mt-1 text-xs font-normal normal-case text-gray-500">
            De AI schrijft een blok &quot;Waarom dit interessant is&quot; bij elk item dat sterk past, tot dit maximum.
            Items die je op &quot;Voor iedereen&quot; zet, tellen mee en gaan voor.
          </span>
        </label>
      )}
    </>
  );
}

// Kop, kopbeeld en algemene inleiding van een gepersonaliseerde nieuwsbrief.
// Gebruikt op het scherm Nieuwe campagne en in de instellingen van de campagne.
export default function PersonalizedFields({ form, setForm, disabled = false }) {
  return (
    <>
      <label className={labelClass}>
        Kop bovenaan (optioneel)
        <input
          value={form.headline}
          onChange={setter(setForm, "headline")}
          disabled={disabled}
          placeholder="Bijv. Wat AI deze maand *voor jullie* betekent"
          className={inputClass}
        />
        <span className="block mt-1 text-xs font-normal normal-case text-gray-500">Zet woorden tussen *sterretjes* voor het oranje accent.</span>
      </label>
      <div className={labelClass}>
        Kopbeeld (optioneel)
        <div className="mt-1">
          {!disabled ? (
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
        Algemene inleiding (optioneel, voor iedereen gelijk)
        <textarea value={form.intro_text} onChange={setter(setForm, "intro_text")} disabled={disabled} rows={4} className={inputClass} />
      </label>
    </>
  );
}
