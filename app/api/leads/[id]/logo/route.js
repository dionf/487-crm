import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { importLogoFromUrl, importLogoFromWebsite, readUploadedFile, uploadLogo } from "@/lib/media";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function loadLead(tenant, id) {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id, tenant, website_url, logo_url")
    .eq("id", id)
    .eq("tenant", tenant)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Response.json({ error: "Bedrijf niet gevonden" }, { status: 404 });
  return data;
}

async function saveLogo(tenant, id, logo) {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .update({
      logo_url: logo?.url || null,
      logo_width: logo?.width || null,
      logo_height: logo?.height || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant", tenant)
    .select("id, logo_url, logo_width, logo_height")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Logo zetten: een upload (multipart "file"), { url } van een afbeelding,
// of { source: "website" } om het van de website van het bedrijf te halen.
export async function POST(request, { params }) {
  try {
    const session = getVerifiedSession(request);
    if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
    const gate = await enforceRateLimit({
      request,
      policy: "session-expensive",
      identifier: session.user_id,
      scope: "/api/leads/logo",
      tenant: session.tenant,
    });
    if (gate.response) return gate.response;

    const { id } = await params;
    const lead = await loadLead(session.tenant, id);
    let logo;
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const buffer = await readUploadedFile(await request.formData());
      logo = await uploadLogo({ tenant: session.tenant, buffer });
    } else {
      const body = await request.json();
      if (body.source === "website") {
        if (!lead.website_url) throw new Error("Dit bedrijf heeft geen website");
        logo = await importLogoFromWebsite({ tenant: session.tenant, websiteUrl: lead.website_url });
      } else if (body.url) {
        logo = await importLogoFromUrl({ tenant: session.tenant, url: String(body.url).trim() });
      } else {
        throw new Error("Geef een bestand, een URL of source: website");
      }
    }
    return Response.json({ lead: await saveLogo(session.tenant, id, logo), source: logo.source || null });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const session = getVerifiedSession(request);
    if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
    const { id } = await params;
    await loadLead(session.tenant, id);
    return Response.json({ lead: await saveLogo(session.tenant, id, null) });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}
