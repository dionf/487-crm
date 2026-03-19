"use client";

import { useState, useEffect } from "react";

export default function PinGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("crm-auth");
    if (stored === "true") {
      setAuthenticated(true);
    }
    setLoading(false);
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (pin === "2025") {
      localStorage.setItem("crm-auth", "true");
      setAuthenticated(true);
      setError(false);
    } else {
      setError(true);
      setPin("");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authenticated) {
    return children;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm mx-auto px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-brand-black rounded-xl flex items-center justify-center">
              <span className="text-brand-amber font-bold text-lg">48</span>
            </div>
            <span className="text-2xl font-bold text-brand-black">-7</span>
          </div>
          <h1 className="text-xl font-semibold text-brand-black">CRM</h1>
          <p className="text-sm text-brand-dark-gray mt-1">
            Voer je pincode in om verder te gaan
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setError(false);
              }}
              placeholder="Pincode"
              className={`w-full text-center text-2xl tracking-[0.5em] py-3 px-4 rounded-2xl border-2 transition-colors outline-none ${
                error
                  ? "border-red-400 bg-red-50"
                  : "border-gray-200 focus:border-brand-amber bg-white"
              }`}
              autoFocus
            />
            {error && (
              <p className="text-red-500 text-sm text-center mt-2">
                Onjuiste pincode
              </p>
            )}
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-brand-amber hover:bg-brand-amber-hover text-brand-black font-semibold rounded-pill transition-colors"
          >
            Inloggen
          </button>
        </form>
      </div>
    </div>
  );
}
