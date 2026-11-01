import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/newsletters";
import {
  fetchCampaignCompanies,
  fetchArticles,
  fetchCampaignItemScores,
  fetchCampaignItems,
  fetchCampaignPersonalizations,
  generatePersonalizationForLead,
  getPersonalizedCampaign,
  regenerateSlotForLead,
  resetCampaignTest,
  slotItemId,
  summarizeCompanyApproval,
} from "@/lib/newsletter-personalize";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canSkipSlot } from "@/lib/newsletter-relevance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Overzicht per ontvangend bedrijf: profiel, ontvangers, slots en reviewstatus.
export async function GET(request, { params }) {
  try {
    const { tenant } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getPersonalizedCampaign(tenant, id);
    const companies = await fetchCampaignCompanies(tenant, campaign);
    const [slots, scores] = await Promise.all([
      fetchCampaignPersonalizations(tenant, id),
      fetchCampaignItemScores(tenant, id),
    ]);
    const result = companies.map((company) => ({
      id: company.id,
      company_name: company.company_name,
      logo_url: company.logo_url,
      website_url: company.website_url,
      newsletter_profile: company.newsletter_profile,
      newsletter_profile_status: company.newsletter_profile_status,
      recipients: company.recipients.map((recipient) => ({ email: recipient.email, name: recipient.name })),
      approval: summarizeCompanyApproval(company, slots),
      slots: slots.filter((slot) => slot.lead_id === company.id),
      // Relevantie per item ({ [item_id]: { score, reason } }); leeg bij
      // personalisaties van vóór de scores.
      scores: scores[company.id] || {},
    }));
    const approved = result.filter((company) => company.approval === "approved").length;
    return Response.json({
      companies: result,
      progress: { approved, total: result.length, ready: result.length > 0 && approved === result.length },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Genereert (opnieuw) de personalisatie voor één bedrijf: { lead_id }.
// Met { lead_id, slot } wordt alleen dat ene onderdeel vernieuwd.
// Met { lead_ids } wordt bij een paar bedrijven tegelijk alles (opnieuw)
// gegenereerd (Genereer ontbrekende / Alles opnieuw). Met { lead_ids, slot:
// "item:<id>" } wordt bij die bedrijven de regel bij dat item geschreven, alleen
// waar hij nog ontbreekt (kolomactie in het overzicht). De UI loopt zelf over
// de bedrijven, in kleine porties, zodat één request binnen de timeout en de
// rate limit blijft.
const MAX_BATCH_LEADS = 5;

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
    const companies = await fetchCampaignCompanies(tenant, campaign);
    if (Array.isArray(body.lead_ids)) {
      return await (body.slot
        ? generateItemForLeads(tenant, campaign, companies, body, userName)
        : generateAllForLeads(tenant, campaign, companies, body, userName));
    }
    const company = companies.find((candidate) => candidate.id === body.lead_id);
    if (!company) return Response.json({ error: "Dit bedrijf ontvangt deze campagne niet" }, { status: 404 });

    const items = await fetchCampaignItems(tenant, id);
    const result = body.slot
      ? { slot: await regenerateSlotForLead(tenant, campaign, items, company, body.slot, userName) }
      : { slots: await generatePersonalizationForLead(tenant, campaign, items, company, userName) };
    await resetCampaignTest(tenant, id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 502 });
  }
}

function batchLeadIds(body) {
  const leadIds = [...new Set(body.lead_ids)];
  if (!leadIds.length || leadIds.length > MAX_BATCH_LEADS) {
    throw Response.json({ error: `Kies 1 tot ${MAX_BATCH_LEADS} bedrijven per keer` }, { status: 400 });
  }
  return leadIds;
}

// Voert `work(company)` parallel uit per bedrijf en meldt mislukte bedrijven
// per naam. `work` geeft de nieuwe slots terug, of null als er niets is gedaan.
// Let op: de rate limit telt per request, dus een portie telt als één hit.
async function runForLeads(tenant, campaign, companies, leadIds, work) {
  const results = await Promise.allSettled(
    leadIds.map(async (leadId) => {
      const company = companies.find((candidate) => candidate.id === leadId);
      if (!company) throw new Error("ontvangt deze campagne niet");
      return { company, slots: await work(company) };
    })
  );
  const slots = [];
  const failures = [];
  let changed = false;
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      if (result.value.slots) {
        slots.push(...result.value.slots);
        changed = true;
      }
      continue;
    }
    const name = companies.find((candidate) => candidate.id === leadIds[index])?.company_name || leadIds[index];
    const reason = result.reason instanceof Response
      ? (await result.reason.json().catch(() => ({}))).error || "mislukt"
      : result.reason?.message || "mislukt";
    failures.push(`${name}: ${reason}`);
  }
  if (changed) await resetCampaignTest(tenant, campaign.id);
  return Response.json({ slots, failures });
}

async function generateAllForLeads(tenant, campaign, companies, body, userName) {
  const leadIds = batchLeadIds(body);
  const items = await fetchCampaignItems(tenant, campaign.id);
  const articles = await fetchArticles(tenant, items);
  return runForLeads(tenant, campaign, companies, leadIds, (company) =>
    generatePersonalizationForLead(tenant, campaign, items, company, userName, articles)
  );
}

async function generateItemForLeads(tenant, campaign, companies, body, userName) {
  const itemId = slotItemId(body.slot);
  if (!itemId) return Response.json({ error: "Kies een item" }, { status: 400 });
  const leadIds = batchLeadIds(body);
  const items = await fetchCampaignItems(tenant, campaign.id);
  if (!items.some((item) => item.id === itemId)) return Response.json({ error: "Item niet gevonden" }, { status: 404 });
  const existing = await fetchCampaignPersonalizations(tenant, campaign.id, leadIds);
  const done = new Set(existing.filter((slot) => slot.slot === body.slot).map((slot) => slot.lead_id));
  const articles = await fetchArticles(tenant, items);
  return runForLeads(tenant, campaign, companies, leadIds, async (company) =>
    done.has(company.id) ? null : [await regenerateSlotForLead(tenant, campaign, items, company, body.slot, userName, articles)]
  );
}

// Bewerk of keur goed.
//   { lead_id, slot, text }            tekst aanpassen (blijft/wordt concept)
//   { lead_id, slot, status }          één slot goedkeuren, terugzetten naar
//                                      concept, weglaten (skipped) of weer tonen
//   { lead_id, approve_all: true }     alle niet-weggelaten slots goedkeuren
export async function PATCH(request, { params }) {
  try {
    const { tenant, userName } = requireAdmin(request);
    const { id } = await params;
    const campaign = await getPersonalizedCampaign(tenant, id, { editable: true });
    const body = await request.json();
    if (!body.lead_id) return Response.json({ error: "lead_id is verplicht" }, { status: 400 });
    const companies = await fetchCampaignCompanies(tenant, campaign);
    if (!companies.some((company) => company.id === body.lead_id)) {
      return Response.json({ error: "Dit bedrijf ontvangt deze campagne niet" }, { status: 404 });
    }
    const now = new Date().toISOString();

    let query;
    if (body.approve_all) {
      query = supabaseAdmin
        .from("newsletter_campaign_personalizations")
        .update({ status: "approved", updated_at: now, edited_by: userName })
        .eq("tenant", tenant)
        .eq("campaign_id", id)
        .eq("lead_id", body.lead_id)
        .neq("status", "skipped");
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
        if (!["draft", "approved", "skipped"].includes(body.status)) {
          return Response.json({ error: "Ongeldige status" }, { status: 400 });
        }
        if (body.status === "skipped" && !canSkipSlot(body.slot)) {
          return Response.json({ error: "Dit onderdeel kun je niet weglaten" }, { status: 400 });
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

    // Weglaten of weer tonen verandert de mail zelf; dat zie je pas in een
    // nieuwe testmail.
    let visibilityChanged = false;
    if (!body.approve_all && "status" in body) {
      const [current] = await fetchCampaignPersonalizations(tenant, id, [body.lead_id]).then((rows) =>
        rows.filter((row) => row.slot === body.slot)
      );
      visibilityChanged = Boolean(current) && (current.status === "skipped") !== (body.status === "skipped");
    }

    const { data, error } = await query.select("*");
    if (error) throw new Error(error.message);
    if (!data?.length) return Response.json({ error: "Geen personalisatie gevonden" }, { status: 404 });
    // Gewijzigde tekst moet eerst in een testmail gezien worden.
    if ("text" in body || visibilityChanged) await resetCampaignTest(tenant, id);
    return Response.json({ slots: data });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}
