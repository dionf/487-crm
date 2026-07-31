import { supabase } from "@/lib/supabase";
import {
  HIPHOT_HUBSPOT_DEAL_ORIGINS,
  HIPHOT_MARKETING_SEGMENTS,
  HIPHOT_MARKETING_STATUSES,
  HIPHOT_RELATION_TYPES,
} from "@/lib/hiphot-marketing";

const HIPHOT_HUBSPOT_DEAL_ORIGIN_IDS = new Set(HIPHOT_HUBSPOT_DEAL_ORIGINS.map((s) => s.id));
const HIPHOT_MARKETING_SEGMENT_IDS = new Set(HIPHOT_MARKETING_SEGMENTS.map((s) => s.id));
const HIPHOT_MARKETING_STATUS_IDS = new Set(HIPHOT_MARKETING_STATUSES.map((s) => s.id));
const HIPHOT_RELATION_TYPE_IDS = new Set(HIPHOT_RELATION_TYPES.map((s) => s.id));
const HIPHOT_MARKETING_FIELD_NAMES = [
  "marketing_consent",
  "marketing_segments",
  "marketing_subscription_status",
  "marketing_consent_source",
  "marketing_consent_date",
  "marketing_unsubscribed_at",
  "marketing_hard_bounced",
  "hubspot_company_id",
  "hubspot_contact_ids",
  "hubspot_subscription_status",
  "hubspot_imported_at",
  "relationship_type",
  "hubspot_deal_origin",
];

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanHubSpotIds(value) {
  return Array.isArray(value)
    ? value.map((id) => String(id).trim()).filter(Boolean)
    : [];
}

function cleanHipHotMarketingPatch(body) {
  const patch = {};

  if ("marketing_segments" in body) {
    patch.marketing_segments = Array.isArray(body.marketing_segments)
      ? body.marketing_segments.filter((id) => HIPHOT_MARKETING_SEGMENT_IDS.has(id))
      : [];
  }
  if ("marketing_subscription_status" in body) {
    patch.marketing_subscription_status = HIPHOT_MARKETING_STATUS_IDS.has(body.marketing_subscription_status)
      ? body.marketing_subscription_status
      : "unknown";
  }
  if ("marketing_consent" in body) patch.marketing_consent = body.marketing_consent === true;
  if ("marketing_consent_source" in body) patch.marketing_consent_source = body.marketing_consent_source || null;
  if ("marketing_consent_date" in body) patch.marketing_consent_date = cleanDate(body.marketing_consent_date);
  if ("marketing_unsubscribed_at" in body) patch.marketing_unsubscribed_at = cleanDate(body.marketing_unsubscribed_at);
  if ("marketing_hard_bounced" in body) patch.marketing_hard_bounced = body.marketing_hard_bounced === true;
  if ("hubspot_company_id" in body) patch.hubspot_company_id = body.hubspot_company_id || null;
  if ("hubspot_contact_ids" in body) patch.hubspot_contact_ids = cleanHubSpotIds(body.hubspot_contact_ids);
  if ("hubspot_subscription_status" in body) patch.hubspot_subscription_status = body.hubspot_subscription_status || null;
  if ("hubspot_imported_at" in body) patch.hubspot_imported_at = cleanDate(body.hubspot_imported_at);
  if ("relationship_type" in body) {
    patch.relationship_type = HIPHOT_RELATION_TYPE_IDS.has(body.relationship_type)
      ? body.relationship_type
      : null;
  }
  if ("hubspot_deal_origin" in body) {
    patch.hubspot_deal_origin = HIPHOT_HUBSPOT_DEAL_ORIGIN_IDS.has(body.hubspot_deal_origin)
      ? body.hubspot_deal_origin
      : null;
  }

  const status = patch.marketing_subscription_status;
  if (patch.marketing_consent === true && !status) {
    patch.marketing_subscription_status = "subscribed";
  }
  if (patch.marketing_consent === false && status === "subscribed") {
    patch.marketing_subscription_status = "non_marketing";
  }
  const hardBounced = patch.marketing_hard_bounced === true || status === "hard_bounce";
  if (hardBounced) patch.marketing_hard_bounced = true;
  if (hardBounced || status === "unsubscribed" || status === "non_marketing") {
    patch.marketing_consent = false;
  }

  return patch;
}

function removeMarketingFields(body) {
  for (const field of HIPHOT_MARKETING_FIELD_NAMES) {
    delete body[field];
  }
}

export async function GET(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = await params;

  const [leadRes, quotesRes, notesRes, activitiesRes, chatbotRes] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).eq("tenant", tenant).single(),
    supabase.from("quotes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase
      .from("form_submissions")
      .select("id")
      .eq("lead_id", id)
      .eq("source", "chatbot")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (leadRes.error) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  return Response.json({
    lead: leadRes.data,
    quotes: quotesRes.data || [],
    notes: notesRes.data || [],
    activities: activitiesRes.data || [],
    chatbot_submission_id: chatbotRes?.data?.id || null,
  });
}

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = await params;
  const body = await request.json();

  // Verify lead belongs to this tenant
  const { data: existing } = await supabase
    .from("leads").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // If status is being changed to "gewonnen", set won_at
  if (body.status === "gewonnen" && !body.won_at) {
    body.won_at = new Date().toISOString();
  }

  // Sync contact_person when first/last name changes
  if (body.contact_first_name !== undefined || body.contact_last_name !== undefined) {
    const first = body.contact_first_name ?? "";
    const last = body.contact_last_name ?? "";
    body.contact_person = `${first} ${last}`.trim();
  }

  // Als delivery_same_as_billing aan staat en er staan billing velden in body, kopieer ze naar delivery
  if (body.delivery_same_as_billing === true) {
    if (body.billing_street !== undefined) body.delivery_street = body.billing_street;
    if (body.billing_house_number !== undefined) body.delivery_house_number = body.billing_house_number;
    if (body.billing_postal_code !== undefined) body.delivery_postal_code = body.billing_postal_code;
    if (body.billing_city !== undefined) body.delivery_city = body.billing_city;
    if (body.billing_country !== undefined) body.delivery_country = body.billing_country;
  }

  if (tenant === "hiphot") {
    const marketingPatch = cleanHipHotMarketingPatch(body);
    removeMarketingFields(body);
    Object.assign(body, marketingPatch);
  } else {
    removeMarketingFields(body);
  }

  const { data, error } = await supabase
    .from("leads")
    .update(body)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ lead: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = await params;

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id)
    .eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
