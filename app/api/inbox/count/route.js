import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;

  const { count, error } = await supabaseAdmin
    .from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant", tenant)
    .eq("status", "nieuw");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ count: count || 0 });
}
