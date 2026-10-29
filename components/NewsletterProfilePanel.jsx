"use client";

import { useState, useEffect } from "react";
import { ChevronRight, Megaphone, Sparkles, Check, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api";

const STATUS_BADGES = {
  approved: { label: "Goedgekeurd", className: "bg-green-50 text-green-700" },
  draft: { label: "Concept", className: "bg-amber-50 text-amber-700" },
};

// Neutraal profiel van het bedrijf voor de gepersonaliseerde nieuwsbrief.
// Los van de AI-bedrijfsanalyse, want die bevat interne verkoopnotities.
export default function NewsletterProfilePanel({ lead, onSaved }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lead.newsletter_profile || "");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) setText(lead.newsletter_profile || "");
  }, [lead.newsletter_profile, editing]);

  async function call(method, body) {
    setError("");
    const res = await apiFetch(`/api/leads/${lead.id}/newsletter-profile`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
    return data;
  }

  async function generate() {
    setBusy("generate");
    setOpen(true);
    try {
      await call("POST");
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  }

  async function save(approve) {
    setBusy(approve ? "approve" : "save");
    try {
      const body = editing ? { newsletter_profile: text } : {};
      if (approve) body.newsletter_profile_status = "approved";
      await call("PATCH", body);
      setEditing(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  }

  const badge = STATUS_BADGES[lead.newsletter_profile_status];

  return (
    <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => e.key === "Enter" && setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <Megaphone className="w-3.5 h-3.5 text-brand-orange" />
            Nieuwsbriefprofiel
          </h3>
          {badge && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-pill ${badge.className}`}>{badge.label}</span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); generate(); }}
          disabled={Boolean(busy)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors disabled:opacity-50"
        >
          {busy === "generate" ? (
            <>
              <div className="w-3 h-3 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
              Genereren...
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              {lead.newsletter_profile ? "Opnieuw" : "Genereer"}
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="px-5 pb-4 space-y-3">
          {error && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</div>}

          {editing ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
          ) : lead.newsletter_profile ? (
            <p className="text-sm text-brand-dark-gray leading-relaxed whitespace-pre-line">{lead.newsletter_profile}</p>
          ) : (
            <p className="text-sm text-gray-400 text-center py-3">
              Nog geen profiel. Klik &quot;Genereer&quot; om er een te maken op basis van de website.
            </p>
          )}

          <p className="text-xs text-gray-400">
            Basis voor de &quot;waarom interessant&quot;-teksten in de nieuwsbrief. Alleen publieke informatie, geen verkoopnotities.
          </p>

          {(editing || lead.newsletter_profile) && (
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <button
                    onClick={() => save(false)}
                    disabled={Boolean(busy)}
                    className="px-3 py-1.5 rounded-pill border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Opslaan als concept
                  </button>
                  <button
                    onClick={() => { setEditing(false); setText(lead.newsletter_profile || ""); }}
                    className="px-3 py-1.5 rounded-pill text-xs font-semibold text-gray-400 hover:text-gray-600"
                  >
                    Annuleren
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-pill border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  <Pencil className="w-3 h-3" />
                  Bewerken
                </button>
              )}
              {(editing || lead.newsletter_profile_status !== "approved") && (
                <button
                  onClick={() => save(true)}
                  disabled={Boolean(busy) || (editing && !text.trim())}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-pill bg-brand-amber hover:bg-brand-amber-hover text-xs font-semibold text-brand-black disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  {editing ? "Opslaan en goedkeuren" : "Goedkeuren"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
