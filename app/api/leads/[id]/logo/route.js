import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { importImageFromUrl, importLogoFromWebsite, readUploadedFile, uploadPublicImage } from "@/lib/media";
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

async function saveLogo(tenant, id, logoUrl) {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant", tenant)
    .select("id, logo_url")
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
    let logoUrl;
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const buffer = await readUploadedFile(await request.formData());
      logoUrl = await uploadPublicImage({ tenant: session.tenant, folder: "logos", buffer });
    } else {
      const body = await request.json();
      if (body.source === "website") {
        if (!lead.website_url) throw new Error("Dit bedrijf heeft geen website");
        logoUrl = await importLogoFromWebsite({ tenant: session.tenant, websiteUrl: lead.website_url });
      } else if (body.url) {
        logoUrl = await importImageFromUrl({ tenant: session.tenant, folder: "logos", url: String(body.url).trim() });
      } else {
        throw new Error("Geef een bestand, een URL of source: website");
      }
    }
    return Response.json({ lead: await saveLogo(session.tenant, id, logoUrl) });
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
