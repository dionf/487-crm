import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// GET /api/auth/organizations — list all orgs for the start screen
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, slug, display_name, theme")
    .order("created_at");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ organizations: data });
}
