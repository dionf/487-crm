"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

const OrgContext = createContext(null);

const SESSION_KEY = "crm-session"; // localStorage key for UI state (not auth)

export function OrgProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Validate session via server cookie (source of truth)
    async function validateSession() {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data.session) {
          setSession(data.session);
          // Cache in localStorage for quick UI access (not used for auth)
          localStorage.setItem(SESSION_KEY, JSON.stringify(data.session));
        } else {
          // Cookie invalid/expired — clear local state
          localStorage.removeItem(SESSION_KEY);
          setSession(null);
        }
      } catch {
        // Network error — try localStorage cache as fallback for UI
        const stored = localStorage.getItem(SESSION_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (new Date(parsed.expires_at) > new Date()) {
              setSession(parsed);
            } else {
              localStorage.removeItem(SESSION_KEY);
            }
          } catch {
            localStorage.removeItem(SESSION_KEY);
          }
        }
      }
      setLoading(false);
    }

    validateSession();
  }, []);

  const login = useCallback((sessionData) => {
    // Cookie is already set by verify-pin, just update UI state
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    setSession(sessionData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Continue logout even if server call fails
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    window.location.href = "/";
  }, []);

  return (
    <OrgContext.Provider
      value={{
        session,
        user: session?.user || null,
        organization: session?.organization || null,
        tenant: session?.tenant || null,
        isAdmin: session?.user?.role === "admin",
        isLoggedIn: !!session,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    // Return safe defaults during SSR/prerender
    return {
      session: null,
      user: null,
      organization: null,
      tenant: null,
      isAdmin: false,
      isLoggedIn: false,
      loading: true,
      login: () => {},
      logout: () => {},
    };
  }
  return ctx;
}
