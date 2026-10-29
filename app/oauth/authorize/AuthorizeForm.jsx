"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

export default function AuthorizeForm({ params, clientName, invalid }) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(decision) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params, email, pin, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      if (res.status === 429) {
        setError("Te veel pogingen. Wacht een kwartier en probeer het opnieuw.");
      } else {
        setError(data.error || "Er ging iets mis");
      }
    } catch {
      setError("Geen verbinding met het CRM");
    }
    setBusy(false);
  }

  // Een fout die Claude zelf moet afhandelen (bijv. geen PKCE): meteen terug.
  if (invalid) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold text-brand-black">Ongeldig koppelverzoek</h1>
        <button
          onClick={() => submit("deny")}
          className="mt-6 w-full py-3 rounded-xl bg-brand-black text-white text-sm font-medium"
        >
          Terug naar {clientName}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit("allow");
      }}
    >
      <div className="text-center mb-8">
        <div className="inline-flex w-12 h-12 rounded-xl items-center justify-center bg-brand-amber/10 text-brand-orange mb-3">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-semibold text-brand-black">{clientName} koppelen</h1>
        <p className="text-sm text-gray-500 mt-1">
          Log in met je CRM-account. {clientName} kan daarna leads, notities, offertes en
          trajecten van jouw organisatie lezen en wijzigen, op jouw naam.
        </p>
      </div>

      <label className="block text-xs font-medium text-gray-500 mb-1">E-mail</label>
      <input
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber mb-4"
      />

      <label className="block text-xs font-medium text-gray-500 mb-1">Pincode</label>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        pattern="\d{4,6}"
        maxLength={6}
        required
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm tracking-widest focus:outline-none focus:border-brand-amber"
      />

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full py-3 rounded-xl bg-brand-black text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        Toegang geven
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => submit("deny")}
        className="mt-2 w-full py-2 text-sm text-gray-500 hover:text-gray-700"
      >
        Annuleren
      </button>
      <p className="text-xs text-gray-400 mt-6 text-center">
        Je kunt de koppeling altijd intrekken via Claude koppelen in het CRM.
      </p>
    </form>
  );
}
