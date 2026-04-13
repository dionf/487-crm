import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");

  const { count, error } = await supabase
    .from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant", tenant)
    .eq("status", "nieuw");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ count: count || 0 });
}
