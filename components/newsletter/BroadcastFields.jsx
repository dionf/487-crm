"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

const MAX_RECIPIENT_LIMIT = 100000;

const numberInputClass = "mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal text-brand-black focus:outline-none focus:border-brand-amber disabled:bg-gray-50";

export function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

// Verzenddatum en tijd van een standaardcampagne. children komt onder het
// datumveld (bijv. de knoppen Tijd opslaan en Opslaan en plannen).
export function ScheduleField({ form, setForm, disabled = false, children }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
      <label className="block text-xs font-semibold text-gray-500 uppercase">Verzenddatum en tijd</label>
      <div className="relative">
        <CalendarClock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="datetime-local"
          value={toDateTimeLocal(form.scheduled_at)}
          disabled={disabled}
          onChange={(e) => {
            const value = fromDateTimeLocal(e.target.value);
            setForm((current) => ({ ...current, scheduled_at: value }));
          }}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
        />
      </div>
      {children}
    </div>
  );
}

// Automatische batches met health-check, of één keer verzenden met een
// maximum aantal ontvangers.
export function BatchFields({ form, setForm, disabled = false }) {
  const set = (field) => (e) => {
    const value = e.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase">Automatische batches</p>
          <p className="text-xs text-gray-500">CRM verstuurt pas verder na een groene health-check.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.batch_mode === "automatic"}
            disabled={disabled}
            onChange={(e) => {
              const batchMode = e.target.checked ? "automatic" : "single";
              setForm((current) => ({ ...current, batch_mode: batchMode }));
            }}
            className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
          />
          Aan
        </label>
      </div>
      {form.batch_mode === "automatic" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-gray-500">
            Batchgrootte
            <input type="number" min="1" max={MAX_RECIPIENT_LIMIT} step="1" value={form.batch_size} disabled={disabled} onChange={set("batch_size")} className={numberInputClass} />
          </label>
          <label className="text-xs font-semibold text-gray-500">
            Wachturen
            <input type="number" min="0.25" step="0.25" value={form.batch_wait_hours} disabled={disabled} onChange={set("batch_wait_hours")} className={numberInputClass} />
          </label>
          <label className="text-xs font-semibold text-gray-500">
            Max bounce
            <input type="number" min="0" max="1" step="0.001" value={form.max_bounce_rate} disabled={disabled} onChange={set("max_bounce_rate")} className={numberInputClass} />
          </label>
          <label className="text-xs font-semibold text-gray-500">
            Max complaints
            <input type="number" min="0" max="1" step="0.001" value={form.max_complaint_rate} disabled={disabled} onChange={set("max_complaint_rate")} className={numberInputClass} />
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-500 uppercase">Max totaal ontvangers</label>
          <input
            type="number"
            min="1"
            max={MAX_RECIPIENT_LIMIT}
            step="1"
            value={form.recipient_limit}
            disabled={disabled}
            onChange={set("recipient_limit")}
            placeholder="Geen limiet"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
          />
        </div>
      )}
    </div>
  );
}

// HTML van de mail met een preview-tab.
export function HtmlEditor({ value, onChange, disabled = false }) {
  const [mode, setMode] = useState("html");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1">
          {[
            { id: "html", label: "HTML" },
            { id: "preview", label: "Preview" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                mode === item.id ? "bg-white text-brand-orange shadow-sm" : "text-gray-500 hover:text-brand-black"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">{value ? "Preview gebruikt de huidige HTML" : "Nog geen HTML"}</p>
      </div>
      {mode === "html" ? (
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="HTML uit Codex of Claude"
          rows={18}
          className="w-full min-h-[440px] px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
        />
      ) : (
        <div className="w-full min-h-[440px] rounded-xl border border-gray-200 bg-white overflow-hidden">
          {value ? (
            <iframe title="Nieuwsbrief preview" sandbox="" srcDoc={value} className="w-full h-[440px] bg-white" />
          ) : (
            <div className="h-[440px] flex items-center justify-center text-sm text-gray-400">
              Plak of laad eerst HTML om de preview te bekijken.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
