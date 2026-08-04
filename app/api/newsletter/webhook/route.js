import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret } from "@/lib/newsletter-crypto";
import { normalizeEmail } from "@/lib/newsletters";

export const dynamic = "force-dynamic";

function valueAt(data, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((obj, key) => obj?.[key], data);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function truthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function marketingBlockForEvent(eventType, eventData) {
  if (eventType === "contact.updated") {
    const unsubscribed = truthy(valueAt(eventData, [
      "unsubscribed",
      "contact.unsubscribed",
      "properties.unsubscribed",
    ]));
    return unsubscribed
      ? { status: "unsubscribed", hardBounced: false, unsubscribed: true }
      : null;
  }

  if (["email.bounced", "email.complained", "email.suppressed"].includes(eventType)) {
    return { status: "hard_bounce", hardBounced: true, unsubscribed: false };
  }

  if (eventType === "suppression.added") {
    const origin = String(valueAt(eventData, ["origin", "suppression.origin"]) || "").toLowerCase();
    return origin === "manual"
      ? { status: "non_marketing", hardBounced: false, unsubscribed: false }
      : { status: "hard_bounce", hardBounced: true, unsubscribed: false };
  }

  return null;
}

async function verifyAgainstTenantSecrets(payload, headers) {
  const { data: settings, error } = await supabaseAdmin
    .from("newsletter_settings")
    .select("tenant, resend_webhook_secret_encrypted")
    .not("resend_webhook_secret_encrypted", "is", null);
  if (error) throw new Error(error.message);

  const verifier = new Resend("re_webhook_verifier");
  for (const setting of settings || []) {
    try {
      const webhookSecret = decryptSecret(setting.resend_webhook_secret_encrypted);
      const event = verifier.webhooks.verify({
        payload,
        headers,
        webhookSecret,
      });
      return { tenant: setting.tenant, event };
    } catch {
      // Try the next tenant secret.
    }
  }
  return null;
}

async function updateMarketingBlock({ tenant, email, eventType, eventData, leadId }) {
  if (!email) return;
  const block = marketingBlockForEvent(eventType, eventData);
  if (!block) return;

  const leadPatch = {
    marketing_consent: false,
    marketing_subscription_status: block.status,
    marketing_hard_bounced: block.hardBounced,
    updated_at: new Date().toISOString(),
  };
  if (block.unsubscribed) leadPatch.marketing_unsubscribed_at = new Date().toISOString();

  let leadQuery = supabaseAdmin
    .from("leads")
    .update(leadPatch)
    .eq("tenant", tenant);
  leadQuery = leadId ? leadQuery.eq("id", leadId) : leadQuery.eq("email", email);
  await leadQuery;

  await supabaseAdmin
    .from("contacts")
    .update({ marketing_consent: false })
    .eq("tenant", tenant)
    .eq("email", email);
}

export async function POST(request) {
  const payload = await request.text();
  const headers = {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };

  try {
    const verified = await verifyAgainstTenantSecrets(payload, headers);
    if (!verified) {
      return Response.json({ error: "Invalid webhook" }, { status: 400 });
    }

    const { tenant, event } = verified;
    const eventType = event.type || event.event || "unknown";
    const eventData = event.data || {};
    const email = normalizeEmail(
      valueAt(eventData, ["to.0", "to", "email", "contact.email", "recipient", "from"])
    );
    const resendEmailId = valueAt(eventData, ["email_id", "id", "email.id"]);
    const resendBroadcastId = valueAt(eventData, ["broadcast_id", "broadcast.id"]);
    const occurredAt = event.created_at || eventData.created_at || new Date().toISOString();

    let campaign = null;
    if (resendBroadcastId) {
      const { data } = await supabaseAdmin
        .from("newsletter_campaigns")
        .select("id")
        .eq("tenant", tenant)
        .eq("resend_broadcast_id", resendBroadcastId)
        .maybeSingle();
      campaign = data;
    }

    let recipient = null;
    if (campaign?.id && email) {
      const { data } = await supabaseAdmin
        .from("newsletter_campaign_recipients")
        .select("id, lead_id")
        .eq("tenant", tenant)
        .eq("campaign_id", campaign.id)
        .eq("email", email)
        .maybeSingle();
      recipient = data;
    }

    const { error: eventError } = await supabaseAdmin.from("newsletter_events").insert({
      tenant,
      campaign_id: campaign?.id || null,
      recipient_id: recipient?.id || null,
      event_type: eventType,
      email: email || null,
      resend_email_id: resendEmailId || null,
      resend_broadcast_id: resendBroadcastId || null,
      payload: event,
      occurred_at: occurredAt,
    });
    if (eventError) throw new Error(eventError.message);

    if (recipient?.id) {
      await supabaseAdmin
        .from("newsletter_campaign_recipients")
        .update({
          status: eventType.replace(/^email\./, ""),
          resend_email_id: resendEmailId || null,
          last_event_at: occurredAt,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant", tenant)
        .eq("id", recipient.id);
    }

    await updateMarketingBlock({ tenant, email, eventType, eventData, leadId: recipient?.lead_id });

    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
