import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const active_only = searchParams.get("active_only") !== "false";

  let query = supabase
    .from("hiphot_articles")
    .select("*")
    .eq("tenant", "hiphot")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (active_only) query = query.eq("is_active", true);
  if (category && category !== "alle") query = query.eq("category", category);
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ articles: data, total: data.length });
}
