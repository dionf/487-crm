"use client";

import { useState } from "react";
import { Plus, Trash2, FileText, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { SERVICE_TYPES, STATUS_COLORS, getLeadStatuses } from "@/lib/constants";

const EMPTY_FORM = { name: "", service_type: "", estimated_value: "" };

// Trajecten (deals) van één bedrijf: elk met eigen status, waarde en offertes.
export default function OpportunitiesPanel({ leadId, tenant, opportunities, quotes, onChanged, onNewQuote }) {
  const statuses = getLeadStatuses(tenant);
  const isHipHot = tenant === "hiphot";
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function request(url, options) {
    setError("");
    const res = await apiFetch(url, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Er ging iets mis");
      return false;
    }
    onChanged?.();
    return true;
  }

  async function createOpportunity(e) {
    e.preventDefault();
    setSaving(true);
    const ok = await request("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: leadId, ...form }),
    });
    setSaving(false);
    if (ok) {
      setForm(EMPTY_FORM);
      setShowForm(false);
    }
  }

  function updateOpportunity(id, patch) {
    return request(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteOpportunity(opportunity) {
    if (!confirm(`Traject "${opportunity.name}" verwijderen?`)) return;
    await request(`/api/opportunities/${opportunity.id}`, { method: "DELETE" });
  }

  return (
    <div className="bg-white border border-gray-100 rounded-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Trajecten ({opportunities.length})
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-amber/10 text-brand-orange text-xs font-semibold hover:bg-brand-amber/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Nieuw traject
        </button>
      </div>

      {showForm && (
        <form onSubmit={createOpportunity} className="bg-brand-light-gray rounded-xl p-3 mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-brand-dark-gray">Nieuw traject</p>
            <button type="button" onClick={() => setShowForm(false)} className="p-0.5 text-gray-400 hover:text-brand-black">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            autoFocus
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Naam, bijv. Vacatureautomatisering"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-brand-amber"
          />
          <div className="flex gap-2">
            {!isHipHot && (
              <select
                value={form.service_type}
                onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-brand-amber"
              >
                <option value="">Service type</option>
                {SERVICE_TYPES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.estimated_value}
              onChange={(e) => setForm({ ...form, estimated_value: e.target.value })}
              placeholder="Waarde (€)"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-brand-amber"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors disabled:opacity-50"
          >
            {saving ? "Opslaan..." : "Traject starten"}
          </button>
        </form>
      )}

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      <div className="space-y-2">
        {opportunities.map((opportunity) => {
          const quoteCount = quotes.filter((q) => q.opportunity_id === opportunity.id).length;
          const colors = STATUS_COLORS[opportunity.status] || STATUS_COLORS.nieuw;
          const serviceLabel = SERVICE_TYPES.find((s) => s.id === opportunity.service_type)?.label;
          return (
            <div key={opportunity.id} className="bg-brand-light-gray rounded-xl p-2.5 group">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold min-w-0 break-words">{opportunity.name}</p>
                {quoteCount === 0 && opportunities.length > 1 && (
                  <button
                    onClick={() => deleteOpportunity(opportunity)}
                    className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 flex-shrink-0"
                    title="Traject verwijderen"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-500">
                {[serviceLabel, opportunity.estimated_value ? formatCurrency(opportunity.estimated_value) : null, `bijgewerkt ${formatRelativeTime(opportunity.updated_at)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="flex items-center gap-1 mt-1.5">
                <select
                  value={opportunity.status}
                  onChange={(e) => updateOpportunity(opportunity.id, { status: e.target.value })}
                  className={`text-[10px] font-bold uppercase px-2 py-1 rounded-pill border-0 cursor-pointer ${colors.bg} ${colors.text}`}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => onNewQuote?.(opportunity.id)}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-pill bg-white text-gray-600 hover:text-brand-orange"
                  title="Offerte voor dit traject"
                >
                  <FileText className="w-3 h-3" />
                  {quoteCount} offerte{quoteCount === 1 ? "" : "s"}
                </button>
              </div>
              {opportunity.lost_reason && ["verloren", "offerte_verloren"].includes(opportunity.status) && (
                <p className="text-[11px] text-gray-500 mt-1">Reden: {opportunity.lost_reason}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
