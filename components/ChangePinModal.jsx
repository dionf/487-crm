"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useOrg } from "@/lib/org-context";

const EMPTY = { current: "", next: "", confirm: "" };

// Vrijwillige pinwijziging vanuit de navbar. De verplichte variant na de eerste
// login is ChangePinForm; hier is de huidige pincode wél verplicht, zodat een
// open gelaten sessie niet genoeg is om iemands pincode over te nemen.
export default function ChangePinModal({ open, onClose }) {
  const { login } = useOrg();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  function close() {
    setForm(EMPTY);
    setError("");
    setDone(false);
    onClose();
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value.replace(/\D/g, "") }));
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.next !== form.confirm) {
      setError("De nieuwe pincodes zijn niet gelijk");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_pin: form.current, new_pin: form.next }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Pincode wijzigen mislukt");
      } else {
        login(data.session);
        setForm(EMPTY);
        setDone(true);
      }
    } catch {
      setError("Verbindingsfout");
    }
    setLoading(false);
  }

  const fields = [
    { key: "current", label: "Huidige pincode", autoComplete: "current-password" },
    { key: "next", label: "Nieuwe pincode (4-6 cijfers)", autoComplete: "new-password" },
    { key: "confirm", label: "Herhaal nieuwe pincode", autoComplete: "new-password" },
  ];

  // Portal naar body: de navbar heeft een backdrop-filter en wordt daarmee het
  // ankerpunt voor position: fixed, waardoor de modal anders in de balk hangt.
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-lg">Pincode wijzigen</h2>
          <button onClick={close} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              Je pincode is gewijzigd. Bij de volgende login gebruik je je nieuwe pincode.
            </p>
            <button
              onClick={close}
              className="w-full py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors"
            >
              Sluiten
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</div>
            )}
            {fields.map((field, i) => (
              <div key={field.key}>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {field.label}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete={field.autoComplete}
                  maxLength={6}
                  required
                  autoFocus={i === 0}
                  value={form[field.key]}
                  onChange={(e) => setField(field.key, e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm tracking-[0.3em] focus:outline-none focus:border-brand-amber"
                />
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={close}
                className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={loading || form.current.length < 4 || form.next.length < 4 || form.confirm.length < 4}
                className="flex-1 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors disabled:opacity-50"
              >
                {loading ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
