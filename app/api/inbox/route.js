import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  let query = supabase
    .from("form_submissions")
    .select("*")
    .eq("tenant", tenant)
    .order("created_at", { ascending: false });

  if (status && status !== "alle") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ submissions: data || [] });
}
