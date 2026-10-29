"use client";

import { useState } from "react";
import { useOrg } from "@/lib/org-context";
import { KeyRound } from "lucide-react";

// Verplichte pinwijziging na de eerste login met een startpincode van de admin.
// PinGate toont dit scherm in plaats van de app; de middleware houdt intussen
// alle beschermde API-routes dicht, dus dit is de enige weg naar binnen.
export default function ChangePinForm() {
  const { user, organization, login, logout } = useOrg();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const accentColor = organization?.theme?.accent || "#F5A623";
  const inputClass = (hasError) =>
    `w-full text-center text-2xl tracking-[0.5em] py-3 px-4 rounded-2xl border-2 transition-colors outline-none ${
      hasError ? "border-red-400 bg-red-50" : "border-gray-200 focus:border-brand-amber bg-white"
    }`;

  async function handleSubmit(e) {
    e.preventDefault();
    if (newPin !== confirmPin) {
      setError("De pincodes zijn niet gelijk");
      setConfirmPin("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_pin: newPin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Pincode wijzigen mislukt");
        setLoading(false);
        return;
      }

      login(data.session);
      // Zelfde als na het inloggen: volledige reload zodat alles de sessie oppakt
      window.location.href = "/";
      return;
    } catch {
      setError("Verbindingsfout");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm mx-auto px-6">
        <div className="text-center mb-8">
          <div
            className="inline-flex w-10 h-10 rounded-full items-center justify-center text-white mb-3"
            style={{ backgroundColor: accentColor }}
          >
            <KeyRound className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-brand-black">
            Welkom {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Kies eerst je eigen pincode. De startpincode die je hebt gekregen vervalt daarmee.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Nieuwe pincode (4-6 cijfers)
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={newPin}
              onChange={(e) => {
                setNewPin(e.target.value.replace(/\D/g, ""));
                setError("");
              }}
              className={`mt-1 ${inputClass(false)}`}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Herhaal pincode
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(e.target.value.replace(/\D/g, ""));
                setError("");
              }}
              className={`mt-1 ${inputClass(!!error)}`}
            />
            {error && <p className="text-red-500 text-sm text-center mt-2">{error}</p>}
          </div>
          <button
            type="submit"
            disabled={loading || newPin.length < 4 || confirmPin.length < 4}
            className="w-full py-3 text-white font-semibold rounded-pill transition-colors disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
          >
            {loading ? "Opslaan..." : "Pincode opslaan"}
          </button>
        </form>

        <button
          onClick={logout}
          className="block mx-auto mt-6 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Uitloggen
        </button>
      </div>
    </div>
  );
}
