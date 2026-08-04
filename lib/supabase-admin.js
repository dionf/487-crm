import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _adminClient = null;

function getAdminClient() {
  if (_adminClient) return _adminClient;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service-role env-vars ontbreken");
  }
  _adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (url, options = {}) =>
        fetch(url, { ...options, cache: "no-store" }),
    },
  });
  return _adminClient;
}

export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getAdminClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
