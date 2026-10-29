import { requireVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listGrants, revokeGrant } from "@/lib/oauth";

export const dynamic = "force-dynamic";

// Gebruikers van de eigen organisatie; een admin beheert alleen koppelingen
// binnen zijn eigen tenant.
async function orgUsers(tenant) {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id, name, organizations!inner(slug)")
    .eq("organizations.slug", tenant);
  return data || [];
}

// GET /api/account/connections — eigen MCP-koppelingen. Admins krijgen met
// ?scope=org die van alle gebruikers in hun organisatie.
export async function GET(request) {
  let session;
  try {
    session = requireVerifiedSession(request);
  } catch (res) {
    return res;
  }

  const wantOrg = new URL(request.url).searchParams.get("scope") === "org";
  if (wantOrg && session.role !== "admin") {
    return Response.json({ error: "Alleen voor admins" }, { status: 403 });
  }

  if (!wantOrg) {
    return Response.json({ connections: await listGrants({ userIds: [session.user_id] }) });
  }

  const users = await orgUsers(session.tenant);
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const connections = users.length ? await listGrants({ userIds: users.map((u) => u.id) }) : [];
  return Response.json({
    connections: connections.map((c) => ({ ...c, user_name: names[c.user_id] || "?" })),
  });
}

// DELETE /api/account/connections?id=… — koppeling intrekken. Eigen
// koppelingen altijd; die van anderen alleen als admin van dezelfde tenant.
export async function DELETE(request) {
  let session;
  try {
    session = requireVerifiedSession(request);
  } catch (res) {
    return res;
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "id is verplicht" }, { status: 400 });

  const { data: grant } = await supabaseAdmin
    .from("oauth_grants")
    .select("id, user_id, users!inner(organizations!inner(slug))")
    .eq("id", id)
    .maybeSingle();

  const ownGrant = grant?.user_id === session.user_id;
  const sameOrgAdmin = session.role === "admin" && grant?.users?.organizations?.slug === session.tenant;
  if (!grant || (!ownGrant && !sameOrgAdmin)) {
    return Response.json({ error: "Koppeling niet gevonden" }, { status: 404 });
  }

  await revokeGrant(grant.id);
  return Response.json({ success: true });
}
