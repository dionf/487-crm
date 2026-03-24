// Tenant-aware fetch wrapper
// All API calls go through this to automatically include the x-tenant header

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
  return session?.tenant || "48-7";
}

export function apiFetch(url, options = {}) {
  const session = getSession();
  const tenant = session?.tenant || "48-7";

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "x-tenant": tenant,
    },
  });
}
