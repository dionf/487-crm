import { getAuthCookie, verifyToken } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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
    supabase
      .from("users")
      .select("id, name, email, role, phone")
      .eq("id", payload.user_id)
      .single(),
    supabase
      .from("organizations")
      .select("id, slug, display_name, pipeline_stages, service_types, theme")
      .eq("slug", payload.tenant)
      .single(),
  ]);

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
      expires_at: new Date(payload.exp * 1000).toISOString(),
    },
  });
}
