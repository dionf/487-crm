import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/newsletters";
import {
  fetchCampaignCompanies,
  fetchCampaignItems,
  fetchCampaignPersonalizations,
  generatePersonalizationForLead,
  getPersonalizedCampaign,
  resetCampaignTest,
  summarizeCompanyApproval,
} from "@/lib/newsletter-personalize";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function isSampleOnly(tenant, campaign, leadId) {
  if (!(campaign.sample_lead_ids || []).includes(leadId)) return false;
  const companies = await fetchCampaignCompanies(tenant, campaign);
  return !companies.some((company) => company.id === leadId);
}

// Overzicht per ontvangend bedrijf: profiel, ontvangers, slots en reviewstatus.
export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getPersonalizedCampaign(tenant, id);
    const companies = await fetchCampaignCompanies(tenant, campaign, { includeSamples: true });
    const slots = await fetchCampaignPersonalizations(tenant, id);
    const result = companies.map((company) => ({
      id: company.id,
      company_name: company.company_name,
      logo_url: company.logo_url,
      website_url: company.website_url,
      sample: company.sample,
      newsletter_profile: company.newsletter_profile,
      newsletter_profile_status: company.newsletter_profile_status,
      recipients: company.recipients.map((recipient) => ({ email: recipient.email, name: recipient.name })),
      approval: summarizeCompanyApproval(company, slots),
      slots: slots.filter((slot) => slot.lead_id === company.id),
    }));
    // Voorbeeldbedrijven tellen niet mee: zij worden nooit verzonden.
    const real = result.filter((company) => !company.sample);
    const approved = real.filter((company) => company.approval === "approved").length;
    return Response.json({
      companies: result,
      progress: { approved, total: real.length, ready: real.length > 0 && approved === real.length },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Genereert (opnieuw) de personalisatie voor één bedrijf: { lead_id }.
// De UI loopt zelf over de bedrijven, zodat één request binnen de timeout blijft.
export async function POST(request, { params }) {
  try {
    const { tenant, userId, userName } = requireAdmin(request);
    const gate = await enforceRateLimit({
      request,
      policy: "session-expensive",
      identifier: userId,
      scope: "/api/newsletter/personalizations",
      tenant,
    });
    if (gate.response) return gate.response;

    const { id } = await params;
    const campaign = await getPersonalizedCampaign(tenant, id, { editable: true });
    const body = await request.json();
    const companies = await fetchCampaignCompanies(tenant, campaign, { includeSamples: true });
    const company = companies.find((candidate) => candidate.id === body.lead_id);
    if (!company) return Response.json({ error: "Dit bedrijf ontvangt deze campagne niet" }, { status: 404 });

    const items = await fetchCampaignItems(tenant, id);
    const slots = await generatePersonalizationForLead(tenant, campaign, items, company, userName);
    // Een voorbeeldbedrijf wordt niet verzonden; de testmail blijft geldig.
    if (!company.sample) await resetCampaignTest(tenant, id);
    return Response.json({ slots });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 502 });
  }
}

// Bewerk of keur goed.
//   { lead_id, slot, text }            tekst aanpassen (blijft/wordt concept)
//   { lead_id, slot, status }          één slot goedkeuren of terugzetten
//   { lead_id, approve_all: true }     alle slots van een bedrijf goedkeuren
export async function PATCH(request, { params }) {
  try {
    const { tenant, userName } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getPersonalizedCampaign(tenant, id, { editable: true });
    const body = await request.json();
    if (!body.lead_id) return Response.json({ error: "lead_id is verplicht" }, { status: 400 });
    const now = new Date().toISOString();

    let query;
    if (body.approve_all) {
      query = supabaseAdmin
        .from("newsletter_campaign_personalizations")
        .update({ status: "approved", updated_at: now, edited_by: userName })
        .eq("tenant", tenant)
        .eq("campaign_id", id)
        .eq("lead_id", body.lead_id);
    } else {
      if (!body.slot) return Response.json({ error: "slot is verplicht" }, { status: 400 });
      const patch = { updated_at: now, edited_by: userName };
      if ("text" in body) {
        const text = String(body.text || "").trim();
        if (!text) return Response.json({ error: "Tekst mag niet leeg zijn" }, { status: 400 });
        patch.content = { text };
        patch.status = "draft";
      }
      if ("status" in body) {
        if (!["draft", "approved"].includes(body.status)) {
          return Response.json({ error: "Ongeldige status" }, { status: 400 });
        }
        patch.status = body.status;
      }
      query = supabaseAdmin
        .from("newsletter_campaign_personalizations")
        .update(patch)
        .eq("tenant", tenant)
        .eq("campaign_id", id)
        .eq("lead_id", body.lead_id)
        .eq("slot", body.slot);
    }

    const { data, error } = await query.select("*");
    if (error) throw new Error(error.message);
    if (!data?.length) return Response.json({ error: "Geen personalisatie gevonden" }, { status: 404 });
    // Gewijzigde tekst moet eerst in een testmail gezien worden (behalve bij
    // een voorbeeldbedrijf dat geen echte ontvanger is).
    if ("text" in body && !(await isSampleOnly(tenant, campaign, body.lead_id))) await resetCampaignTest(tenant, id);
    return Response.json({ slots: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}
