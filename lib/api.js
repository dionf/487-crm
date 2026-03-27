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
