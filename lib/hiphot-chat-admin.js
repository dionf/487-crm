const CHAT_API_BASE =
  process.env.HIPHOT_CHAT_ADMIN_API_BASE || "https://hh-offerte-chat-nl.vercel.app/api";
const CHAT_ADMIN_KEY = process.env.HIPHOT_CHAT_ADMIN_KEY;

export async function hiphotChatAdminFetch(path, options = {}) {
  if (!CHAT_ADMIN_KEY) {
    throw new Error("HIPHOT_CHAT_ADMIN_KEY ontbreekt");
  }

  const response = await fetch(`${CHAT_API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Chat-Admin-Key": CHAT_ADMIN_KEY,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "Ongeldig antwoord van chat-backend" };
  }

  if (!response.ok) {
    throw new Error(data?.error || `Chat-backend fout ${response.status}`);
  }

  return data;
}
