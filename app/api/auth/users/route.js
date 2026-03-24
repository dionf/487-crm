import { supabase } from "@/lib/supabase";

// GET /api/auth/users?org_id=xxx — list users for an organization
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id");

  if (!orgId) {
    return Response.json({ error: "org_id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, name, role")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ users: data });
}
