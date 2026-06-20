import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY Supabase client. Uses the service_role key, which bypasses RLS.
// Never import this from a Client Component — that would leak the key to the browser.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client = null;

function getClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase.js is server-only en mag niet in een Client Component gebruikt worden."
    );
  }
  if (_client) return _client;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Supabase env-vars ontbreken (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  _client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options = {}) =>
        fetch(url, { ...options, cache: "no-store" }),
    },
  });
  return _client;
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
