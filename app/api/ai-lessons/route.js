import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/ai-lessons — lijst geleerde regels voor de ingelogde tenant.
// Iedere ingelogde user kan lezen (middleware doet cookie-auth).
export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (!tenant) return Response.json({ error: "Niet ingelogd" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") || "active"; // active | inactive | all

  let query = supabase
    .from("ai_quote_lessons")
    .select("*")
    .eq("tenant", tenant)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (filter === "active") query = query.eq("is_active", true);
  else if (filter === "inactive") query = query.eq("is_active", false);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ lessons: data || [] });
}
