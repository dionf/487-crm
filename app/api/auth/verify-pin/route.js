import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";

// POST /api/auth/verify-pin — verify user pin
export async function POST(request) {
  const { user_id, pin } = await request.json();

  if (!user_id || !pin) {
    return Response.json({ error: "user_id and pin are required" }, { status: 400 });
  }

  // Hash the provided pin
  const pinHash = createHash("sha256").update(pin).digest("hex");

  // Fetch user with org info
  const { data: user, error } = await supabase
    .from("users")
    .select("id, name, email, role, organization_id, pin_hash, organizations(id, slug, display_name, pipeline_stages, service_types, theme)")
    .eq("id", user_id)
    .eq("is_active", true)
    .single();

  if (error || !user) {
    return Response.json({ error: "Gebruiker niet gevonden" }, { status: 404 });
  }

  if (user.pin_hash !== pinHash) {
    return Response.json({ error: "Onjuiste pincode" }, { status: 401 });
  }

  // Return session data (no JWT needed for this simple auth)
  return Response.json({
    success: true,
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      organization: user.organizations,
      tenant: user.organizations.slug,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
    },
  });
}
