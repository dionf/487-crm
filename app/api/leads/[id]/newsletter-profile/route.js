import { getVerifiedSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateNewsletterProfile } from "@/lib/newsletter-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROFILE_FIELDS = "id, newsletter_profile, newsletter_profile_status, newsletter_profile_updated_at";

async function loadLead(id, tenant, fields = "*") {
  const { data } = await supabaseAdmin
    .from("leads")
    .select(fields)
    .eq("id", id)
    .eq("tenant", tenant)
    .single();
  return data;
}

// Genereert een nieuw profiel als concept. Een bestaand profiel wordt overschreven.
export async function POST(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });

  // Scrapet een website en roept de Claude API aan, dus begrensd per gebruiker.
  const gate = await enforceRateLimit({
    request,
    policy: "session-expensive",
    identifier: session.user_id,
    scope: "/api/leads/newsletter-profile",
    tenant: session.tenant,
  });
  if (gate.response) return gate.response;

  const { id } = await params;
  const lead = await loadLead(id, session.tenant);
  if (!lead) return Response.json({ error: "Lead niet gevonden" }, { status: 404 });

  try {
    const profile = await generateNewsletterProfile(lead);
    const { data, error } = await supabaseAdmin
      .from("leads")
      .update({
        newsletter_profile: profile,
        newsletter_profile_status: "draft",
        newsletter_profile_updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant", session.tenant)
      .select(PROFILE_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    return Response.json({ lead: data });
  } catch (err) {
    console.error("Nieuwsbriefprofiel genereren mislukt:", id, err);
    return Response.json({ error: `Profiel genereren mislukt: ${err.message}` }, { status: 502 });
  }
}

// Bewerkt de tekst en/of de status (draft / approved).
export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });

  const { id } = await params;
  const existing = await loadLead(id, session.tenant, "id, newsletter_profile");
  if (!existing) return Response.json({ error: "Lead niet gevonden" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const updates = { newsletter_profile_updated_at: new Date().toISOString() };

  if (typeof body.newsletter_profile === "string") {
    const text = body.newsletter_profile.trim();
    updates.newsletter_profile = text || null;
    // Een bewerkte tekst moet opnieuw goedgekeurd worden, tenzij dat tegelijk gebeurt.
    updates.newsletter_profile_status = text ? "draft" : null;
  }
  if (body.newsletter_profile_status !== undefined) {
    if (!["draft", "approved"].includes(body.newsletter_profile_status)) {
      return Response.json({ error: "Ongeldige status" }, { status: 400 });
    }
    updates.newsletter_profile_status = body.newsletter_profile_status;
  }
  const resultingProfile = "newsletter_profile" in updates ? updates.newsletter_profile : existing.newsletter_profile;
  if (updates.newsletter_profile_status === "approved" && !resultingProfile) {
    return Response.json({ error: "Er is geen profiel om goed te keuren" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("leads")
    .update(updates)
    .eq("id", id)
    .eq("tenant", session.tenant)
    .select(PROFILE_FIELDS)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ lead: data });
}
