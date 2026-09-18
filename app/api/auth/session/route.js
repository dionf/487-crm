import { getAuthCookie, verifyToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/auth/session — validate cookie and return current session
export async function GET(request) {
  const token = getAuthCookie(request);
  if (!token) {
    return Response.json({ session: null });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return Response.json({ session: null });
  }

  // Fetch fresh user + org data (may have changed since login)
  const [{ data: freshUser }, { data: org }] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id, name, email, role, phone, must_change_pin")
      .eq("id", payload.user_id)
      .single(),
    supabaseAdmin
      .from("organizations")
      .select("id, slug, display_name, pipeline_stages, service_types, theme")
      .eq("slug", payload.tenant)
      .single(),
  ]);

  // Startsessie waarvan de pinwijziging al elders is afgerond: de middleware
  // blijft hem weigeren (claim in het JWT) en change-pin accepteert hem niet
  // meer als verplichte wijziging. Opnieuw inloggen is de enige weg verder.
  if (payload.pin_change_required === true && freshUser?.must_change_pin !== true) {
    return Response.json({ session: null });
  }

  return Response.json({
    session: {
      user: {
        id: freshUser?.id || payload.user_id,
        name: freshUser?.name || payload.name,
        email: freshUser?.email || payload.email,
        role: freshUser?.role || payload.role,
        phone: freshUser?.phone || null,
      },
      organization: org || { slug: payload.tenant },
      tenant: payload.tenant,
      must_change_pin: payload.pin_change_required === true,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    },
  });
}
