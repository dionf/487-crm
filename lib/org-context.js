"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

const OrgContext = createContext(null);

const SESSION_KEY = "crm-session";

export function OrgProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load session from localStorage
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Check expiry
        if (new Date(parsed.expires_at) > new Date()) {
          setSession(parsed);
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback((sessionData) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    setSession(sessionData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
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
