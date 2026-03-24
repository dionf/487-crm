import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";

function getTenant(request) {
  return request.headers.get("x-tenant") || "48-7";
}

// GET /api/admin/users — list users for current tenant's org
export async function GET(request) {
  const tenant = getTenant(request);

  // Find org by slug
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", tenant)
    .single();

  if (!org) return Response.json({ error: "Org niet gevonden" }, { status: 404 });

  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role, is_active, created_at")
    .eq("organization_id", org.id)
    .order("name");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ users: data });
}

// POST /api/admin/users — create a new user
export async function POST(request) {
  const tenant = getTenant(request);
  const body = await request.json();
  const { name, email, pin, role } = body;

  if (!name || !email || !pin) {
    return Response.json({ error: "name, email en pin zijn verplicht" }, { status: 400 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", tenant)
    .single();

  if (!org) return Response.json({ error: "Org niet gevonden" }, { status: 404 });

  const pinHash = createHash("sha256").update(pin).digest("hex");

  const { data, error } = await supabase
    .from("users")
    .insert({
      organization_id: org.id,
      name,
      email,
      pin_hash: pinHash,
      role: role || "agent",
    })
    .select("id, name, email, role, is_active, created_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ user: data }, { status: 201 });
}
