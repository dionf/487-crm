"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { format, addDays } from "date-fns";

export default function QuoteForm({ open, onClose, leadId, onSaved }) {
  const [form, setForm] = useState({
    amount_excl_vat: "",
    vat_percentage: "21",
    description: "",
    valid_until: format(addDays(new Date(), 30), "yyyy-MM-dd"),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function getCurrentUser() {
    if (typeof window !== "undefined") {
      return localStorage.getItem("crm-user") || "Dion";
    }
    return "Dion";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          amount_excl_vat: parseFloat(form.amount_excl_vat),
          vat_percentage: parseFloat(form.vat_percentage),
          description: form.description || null,
          valid_until: form.valid_until || null,
          created_by: getCurrentUser(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fout bij opslaan");
      }

      setForm({
        amount_excl_vat: "",
        vat_percentage: "21",
        description: "",
        valid_until: format(addDays(new Date(), 30), "yyyy-MM-dd"),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const exclVat = parseFloat(form.amount_excl_vat) || 0;
  const vatPerc = parseFloat(form.vat_percentage) || 21;
  const vatAmount = exclVat * (vatPerc / 100);
  const inclVat = exclVat + vatAmount;

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-lg">Nieuwe Offerte</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Bedrag excl. BTW *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={form.amount_excl_vat}
              onChange={(e) => setForm({ ...form, amount_excl_vat: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                BTW %
              </label>
              <input
                type="number"
                step="0.01"
                value={form.vat_percentage}
                onChange={(e) => setForm({ ...form, vat_percentage: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Geldig tot
              </label>
              <input
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
              />
            </div>
          </div>

          {/* Price preview */}
          <div className="bg-brand-light-gray rounded-xl p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Excl. BTW</span>
              <span className="font-medium">&euro; {exclVat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">BTW ({vatPerc}%)</span>
              <span className="font-medium">&euro; {vatAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-1 mt-1">
              <span>Incl. BTW</span>
              <span>&euro; {inclVat.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Omschrijving
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber resize-none"
              placeholder="Beschrijf de offerte..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors disabled:opacity-50"
            >
              {loading ? "Opslaan..." : "Offerte aanmaken"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
