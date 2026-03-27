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

  // Fetch fresh org data (theme may have changed)
  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, display_name, pipeline_stages, service_types, theme")
    .eq("slug", payload.tenant)
    .single();

  return Response.json({
    session: {
      user: {
        id: payload.user_id,
        name: payload.name,
        email: payload.email,
        role: payload.role,
      },
      organization: org || { slug: payload.tenant },
      tenant: payload.tenant,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    },
  });
}
