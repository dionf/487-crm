"use client";

import { useState, useEffect } from "react";
import { useOrg } from "@/lib/org-context";
import { ArrowLeft } from "lucide-react";

export default function PinGate({ children }) {
  const { isLoggedIn, loading: sessionLoading, login } = useOrg();

  const [step, setStep] = useState("org"); // org → user → pin
  const [orgs, setOrgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Fetch organizations on mount
  useEffect(() => {
    if (!isLoggedIn) {
      fetch("/api/auth/organizations")
        .then((r) => r.json())
        .then((data) => setOrgs(data.organizations || []))
        .catch(() => {});
    }
  }, [isLoggedIn]);

  // Fetch users when org is selected
  useEffect(() => {
    if (selectedOrg) {
      fetch(`/api/auth/users?org_id=${selectedOrg.id}`)
        .then((r) => r.json())
        .then((data) => setUsers(data.users || []))
        .catch(() => {});
    }
  }, [selectedOrg]);

  async function handlePinSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUser.id, pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Onjuiste pincode");
        setPin("");
        setLoading(false);
        return;
      }

      login(data.session);
      // Force reload to ensure all components pick up the new session/tenant
      window.location.href = "/";
      return;
    } catch {
      setError("Verbindingsfout");
    }
    setLoading(false);
  }

  function goBack() {
    setError("");
    setPin("");
    if (step === "pin") {
      setStep("user");
      setSelectedUser(null);
    } else if (step === "user") {
      setStep("org");
      setSelectedOrg(null);
      setUsers([]);
    }
  }

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isLoggedIn) return children;

  const accentColor = selectedOrg?.theme?.accent || "#F5A623";

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm mx-auto px-6">
        {/* Back button */}
        {step !== "org" && (
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Terug
          </button>
        )}

        {/* Step 1: Choose organization */}
        {step === "org" && (
          <>
            <div className="text-center mb-8">
              <h1 className="text-xl font-semibold text-brand-black">Welkom</h1>
              <p className="text-sm text-gray-500 mt-1">
                Kies je organisatie
              </p>
            </div>
            <div className="space-y-3">
              {orgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => {
                    setSelectedOrg(org);
                    setStep("user");
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-gray-300 transition-colors text-left"
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white text-sm"
                    style={{ backgroundColor: org.theme?.accent || "#333" }}
                  >
                    {org.theme?.logo_text || org.slug}
                  </div>
                  <div>
                    <p className="font-semibold text-brand-black">{org.display_name}</p>
                    <p className="text-xs text-gray-400">{org.slug}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: Choose user */}
        {step === "user" && (
          <>
            <div className="text-center mb-8">
              <div
                className="inline-flex w-12 h-12 rounded-xl items-center justify-center font-bold text-white text-sm mb-3"
                style={{ backgroundColor: accentColor }}
              >
                {selectedOrg?.theme?.logo_text || selectedOrg?.slug}
              </div>
              <h1 className="text-xl font-semibold text-brand-black">{selectedOrg?.display_name}</h1>
              <p className="text-sm text-gray-500 mt-1">Wie ben je?</p>
            </div>
            <div className="space-y-2">
              {users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => {
                    setSelectedUser(user);
                    setStep("pin");
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-300 transition-colors text-left"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                    style={{ backgroundColor: accentColor }}
                  >
                    {user.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{user.role}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 3: Enter pin */}
        {step === "pin" && (
          <>
            <div className="text-center mb-8">
              <div
                className="inline-flex w-10 h-10 rounded-full items-center justify-center text-white font-semibold text-sm mb-3"
                style={{ backgroundColor: accentColor }}
              >
                {selectedUser?.name.charAt(0)}
              </div>
              <h1 className="text-lg font-semibold text-brand-black">
                Hallo {selectedUser?.name.split(" ")[0]}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Voer je pincode in
              </p>
            </div>

            <form onSubmit={handlePinSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ""));
                    setError("");
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
                    {error}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || pin.length < 4}
                className="w-full py-3 text-white font-semibold rounded-pill transition-colors disabled:opacity-50"
                style={{ backgroundColor: accentColor }}
              >
                {loading ? "Verifiëren..." : "Inloggen"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
