import { supabase } from "@/lib/supabase";

// GET /api/auth/organizations — list all orgs for the start screen
export async function GET() {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, display_name, theme")
    .order("created_at");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ organizations: data });
}
