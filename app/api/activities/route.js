import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lead_id = searchParams.get("lead_id");

  let query = supabase
    .from("activities")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (lead_id) query = query.eq("lead_id", lead_id);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ activities: data });
}
