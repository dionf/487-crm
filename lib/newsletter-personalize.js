import { generateNewsletterJson } from "@/lib/newsletter-ai";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildRecipientsForCampaign } from "@/lib/newsletters";

export const SECTION_LABELS = {
  company_news: "Nieuws van 48-7",
  ai_news: "AI-nieuws",
  tips: "Tips & tricks",
};
export const SECTION_ORDER = ["company_news", "ai_news", "tips"];

const ITEM_SLOT_PREFIX = "item:";
export const itemSlot = (itemId) => `${ITEM_SLOT_PREFIX}${itemId}`;
export const slotItemId = (slot) => (slot?.startsWith(ITEM_SLOT_PREFIX) ? slot.slice(ITEM_SLOT_PREFIX.length) : null);

// Hoeveel items per opzet een eigen "waarom interessant"-regel krijgen.
const ITEM_LINES_BY_LAYOUT = { intro: 0, combined: 2, per_item: Infinity };

export function sortItems(items = []) {
  return [...items].sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
}

export async function fetchCampaignItems(tenant, campaignId) {
  const { data, error } = await supabaseAdmin
    .from("newsletter_campaign_items")
    .select("*")
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId);
  if (error) throw new Error(error.message);
  return sortItems(data || []);
}

export async function fetchCampaignPersonalizations(tenant, campaignId, leadIds = null) {
  let query = supabaseAdmin
    .from("newsletter_campaign_personalizations")
    .select("*")
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId);
  if (leadIds) query = query.in("lead_id", leadIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

// Ontvangende bedrijven van een campagne, met hun ontvangers en profiel.
export async function fetchCampaignCompanies(tenant, campaign) {
  const { recipients } = await buildRecipientsForCampaign(
    tenant,
    campaign.segment_id,
    campaign.excluded_segment_ids || [],
    campaign.recipient_limit,
    campaign.included_segment_ids || []
  );
  const byLead = new Map();
  for (const recipient of recipients || []) {
    if (!byLead.has(recipient.lead_id)) byLead.set(recipient.lead_id, []);
    byLead.get(recipient.lead_id).push(recipient);
  }
  const leadIds = [...byLead.keys()];
  if (!leadIds.length) return [];

  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select("id, company_name, website_url, industry, newsletter_profile, newsletter_profile_status")
    .eq("tenant", tenant)
    .in("id", leadIds);
  if (error) throw new Error(error.message);
  return (leads || [])
    .map((lead) => ({ ...lead, recipients: byLead.get(lead.id) || [] }))
    .sort((a, b) => String(a.company_name || "").localeCompare(String(b.company_name || ""), "nl"));
}

// JSON-schema voor de personalisatie van één bedrijf. Structured outputs kent
// geen maxItems; het maximum aantal itemregels staat in de prompt en wordt bij
// het opslaan afgedwongen.
function personalizationSchema(layout) {
  const properties = {
    subject: {
      type: "string",
      description: "Onderwerpregel voor dit bedrijf, max 70 tekens, begint met de bedrijfsnaam of verwijst er duidelijk naar.",
    },
    preheader: {
      type: "string",
      description: "Preheader (voorbeeldtekst in de inbox), max 110 tekens, maakt nieuwsgierig.",
    },
  };
  const required = ["subject", "preheader"];
  if (layout !== "per_item") {
    properties.intro = {
      type: "string",
      description:
        "Intro-hook van 1-3 zinnen voor het blok 'In deze nieuwsbrief voor {bedrijf}': noem welke items voor hen het meest relevant zijn en waarom, zodat ze verder lezen.",
    };
    required.push("intro");
  }
  if ((ITEM_LINES_BY_LAYOUT[layout] ?? 2) > 0) {
    properties.items = {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Het id van het item, exact overgenomen." },
          text: { type: "string", description: "2-3 zinnen: waarom dit item voor dit bedrijf interessant is." },
        },
        required: ["item_id", "text"],
        additionalProperties: false,
      },
    };
    required.push("items");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function itemLinesInstruction(layout, itemCount) {
  const maxItemLines = Math.min(ITEM_LINES_BY_LAYOUT[layout] ?? 2, itemCount);
  if (maxItemLines === 0) return "- Laat items leeg: deze opzet heeft geen regels per item.";
  if (layout === "per_item") return "- Schrijf in items voor elk item een regel 'waarom interessant'.";
  return `- Schrijf in items alleen een regel voor de ${maxItemLines} items die het meest relevant zijn (maximaal ${maxItemLines}). Liever minder items dan een geforceerde koppeling.`;
}

function buildPrompt(campaign, items, lead) {
  const itemText = items
    .map(
      (item) =>
        `[id: ${item.id}] (${SECTION_LABELS[item.section] || item.section}) ${item.title}\n${item.body}${item.url ? `\nLink: ${item.url}` : ""}`
    )
    .join("\n\n");

  return `Je schrijft de gepersonaliseerde stukken van een nieuwsbrief van 48-7 AI Professionals (AI-oplossingen, trainingen en maatwerk voor het mkb). De rest van de nieuwsbrief is voor iedereen gelijk.

Ontvangend bedrijf: ${lead.company_name}
Profiel van het bedrijf:
${lead.newsletter_profile}

Onderwerp van de campagne (basis voor de onderwerpregel): ${campaign.subject}

Items in deze editie:
${itemText}

REGELS:
- Schrijf in het Nederlands, in de jij/jullie-vorm, helder en concreet, zonder hype of uitroeptekens.
- Gebruik ALLEEN wat in het profiel en de items staat. Verzin geen feiten over het bedrijf (geen systemen, aantallen, klanten of problemen die niet in het profiel staan).
- Is een verband zwak, kies dan een ander item of formuleer het als mogelijkheid ("als jullie ...").
- Geen verkooppraat en geen prijzen. Noem geen namen van personen.
${itemLinesInstruction(campaign.personalization_layout || "combined", items.length)}`;
}

// Genereert de slots voor één bedrijf en slaat ze op als concept. Bestaande
// slots van dit bedrijf voor deze campagne worden vervangen.
export async function generatePersonalizationForLead(tenant, campaign, items, lead, userName) {
  if (!lead.newsletter_profile) throw new Error(`${lead.company_name} heeft nog geen nieuwsbriefprofiel`);
  if (!items.length) throw new Error("De campagne heeft nog geen items");

  const layout = campaign.personalization_layout || "combined";
  const output = await generateNewsletterJson(buildPrompt(campaign, items, lead), personalizationSchema(layout));
  const maxItemLines = Math.min(ITEM_LINES_BY_LAYOUT[layout] ?? 2, items.length);

  const itemIds = new Set(items.map((item) => item.id));
  const now = new Date().toISOString();
  const rows = [];
  const add = (slot, content) => {
    if (!content?.text?.trim()) return;
    rows.push({
      tenant,
      campaign_id: campaign.id,
      lead_id: lead.id,
      slot,
      content: { text: content.text.trim() },
      status: "draft",
      generated_at: now,
      edited_by: userName || null,
      updated_at: now,
    });
  };
  add("subject", { text: output.subject });
  add("preheader", { text: output.preheader });
  if (layout !== "per_item") add("intro", { text: output.intro });
  for (const entry of (Array.isArray(output.items) ? output.items : []).slice(0, maxItemLines)) {
    if (itemIds.has(entry.item_id)) add(itemSlot(entry.item_id), { text: entry.text });
  }

  const { error: deleteError } = await supabaseAdmin
    .from("newsletter_campaign_personalizations")
    .delete()
    .eq("tenant", tenant)
    .eq("campaign_id", campaign.id)
    .eq("lead_id", lead.id);
  if (deleteError) throw new Error(deleteError.message);

  const { data, error } = await supabaseAdmin
    .from("newsletter_campaign_personalizations")
    .insert(rows)
    .select("*");
  if (error) throw new Error(error.message);
  return data || [];
}

// Per bedrijf: zijn alle slots aanwezig en goedgekeurd?
export function summarizeCompanyApproval(company, slots) {
  const own = slots.filter((slot) => slot.lead_id === company.id);
  if (!own.length) return "missing";
  return own.every((slot) => slot.status === "approved") ? "approved" : "draft";
}

const EDITABLE_STATUSES = new Set(["draft", "tested", "failed"]);

export async function getPersonalizedCampaign(tenant, id, { editable = false } = {}) {
  const { data, error } = await supabaseAdmin
    .from("newsletter_campaigns")
    .select("*")
    .eq("tenant", tenant)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Response.json({ error: "Campagne niet gevonden" }, { status: 404 });
  if (data.mode !== "personalized") {
    throw Response.json({ error: "Dit is geen gepersonaliseerde campagne" }, { status: 400 });
  }
  if (editable && !EDITABLE_STATUSES.has(data.status)) {
    throw Response.json({ error: "Alleen concept-, test- en mislukte campagnes kunnen worden bewerkt" }, { status: 400 });
  }
  return data;
}

// Een eerdere testverzending vervalt: na een wijziging eerst opnieuw testen.
export async function resetCampaignTest(tenant, campaignId) {
  await supabaseAdmin
    .from("newsletter_campaigns")
    .update({ status: "draft", test_sent_at: null, approved_at: null, approved_by: null, updated_at: new Date().toISOString() })
    .eq("tenant", tenant)
    .eq("id", campaignId)
    .in("status", ["tested", "failed"]);
}

// Na een inhoudelijke wijziging moet alles opnieuw bekeken worden: goedgekeurde
// personalisaties terug naar concept en een eerdere testverzending vervalt.
export async function invalidateCampaignApprovals(tenant, campaignId) {
  await supabaseAdmin
    .from("newsletter_campaign_personalizations")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId)
    .eq("status", "approved");
  await resetCampaignTest(tenant, campaignId);
}

// Valideert invoer voor een nieuwsitem (partial = alleen meegestuurde velden).
export function normalizeItemInput(body, { partial = false } = {}) {
  const item = {};
  if (!partial || "section" in body) {
    if (!SECTION_ORDER.includes(body.section)) throw new Error("Ongeldige sectie");
    item.section = body.section;
  }
  if (!partial || "title" in body) {
    const title = String(body.title || "").trim();
    if (!title) throw new Error("Titel is verplicht");
    item.title = title;
  }
  for (const field of ["body", "url", "link_label", "image_url"]) {
    if (!partial || field in body) {
      const value = String(body[field] || "").trim();
      item[field] = field === "body" ? value : value || null;
    }
  }
  if (item.url && !/^https?:\/\//i.test(item.url)) throw new Error("Link moet met http:// of https:// beginnen");
  if ("sort_order" in body) item.sort_order = Number.parseInt(body.sort_order, 10) || 0;
  return item;
}
