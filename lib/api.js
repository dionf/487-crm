// API fetch wrapper
// Auth is handled by httpOnly cookie (set by verify-pin, verified by middleware)
// No need to inject headers — the cookie is sent automatically

function getSession() {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("crm-session");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function getTenantFromSession() {
  const session = getSession();
  return session?.tenant || null;
}

export function isAdminFromSession() {
  const session = getSession();
  return session?.user?.role === "admin";
}

export function getUserIdFromSession() {
  const session = getSession();
  return session?.user?.id || null;
}

export function apiFetch(url, options = {}) {
  // Cookie is sent automatically — no custom headers needed
  return fetch(url, options);
}

// DELETE met foutafhandeling: geeft null bij succes, anders een foutmelding voor de gebruiker.
export async function apiDelete(url, fallback) {
  let res;
  try {
    res = await apiFetch(url, { method: "DELETE" });
  } catch {
    return `${fallback}: geen verbinding met de server`;
  }
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error || fallback;
}
