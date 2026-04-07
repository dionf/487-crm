import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const { searchParams } = new URL(request.url);
  const lead_id = searchParams.get("lead_id");
  const quote_id = searchParams.get("quote_id");

  let query = supabase
    .from("quote_emails")
    .select("*")
    .eq("tenant", tenant)
    .order("sent_at", { ascending: false });

  if (lead_id) query = query.eq("lead_id", lead_id);
  if (quote_id) query = query.eq("quote_id", quote_id);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ emails: data });
}
