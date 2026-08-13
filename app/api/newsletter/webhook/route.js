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

async function upsertEmailSuppression({ tenant, email, block, eventType, eventData, resendBroadcastId, resendEmailId, occurredAt }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !block) return;

  const { error } = await supabaseAdmin
    .from("newsletter_email_suppressions")
    .upsert(
      {
        tenant,
        email: normalizedEmail,
        status: block.status,
        reason: eventType,
        source: "resend_webhook",
        resend_broadcast_id: resendBroadcastId || null,
        resend_email_id: resendEmailId || null,
        payload: eventData || null,
        suppressed_at: occurredAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant,email" }
    );
  if (error) throw new Error(error.message);
}

async function updateRecipientMarketingBlock({
  tenant,
  email,
  eventType,
  eventData,
  recipient,
  resendBroadcastId,
  resendEmailId,
  occurredAt,
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  const block = marketingBlockForEvent(eventType, eventData);
  if (!block) return;

  await upsertEmailSuppression({
    tenant,
    email: normalizedEmail,
    block,
    eventType,
    eventData,
    resendBroadcastId,
    resendEmailId,
    occurredAt,
  });

  if (recipient?.contact_id) {
    await supabaseAdmin
      .from("contacts")
      .update({ marketing_consent: false })
      .eq("tenant", tenant)
      .eq("id", recipient.contact_id);
    return;
  }

  await supabaseAdmin
    .from("contacts")
    .update({ marketing_consent: false })
    .eq("tenant", tenant)
    .eq("email", normalizedEmail);
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
      if (!campaign) {
        const { data: batch } = await supabaseAdmin
          .from("newsletter_campaign_batches")
          .select("campaign_id")
          .eq("tenant", tenant)
          .eq("resend_broadcast_id", resendBroadcastId)
          .maybeSingle();
        if (batch?.campaign_id) campaign = { id: batch.campaign_id };
      }
      if (!campaign) {
        const { data: recipientMatch } = await supabaseAdmin
          .from("newsletter_campaign_recipients")
          .select("campaign_id")
          .eq("tenant", tenant)
          .eq("resend_broadcast_id", resendBroadcastId)
          .limit(1)
          .maybeSingle();
        if (recipientMatch?.campaign_id) campaign = { id: recipientMatch.campaign_id };
      }
    }

    let recipient = null;
    if (campaign?.id && email) {
      const { data } = await supabaseAdmin
        .from("newsletter_campaign_recipients")
        .select("id, lead_id, contact_id")
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

    await updateRecipientMarketingBlock({
      tenant,
      email,
      eventType,
      eventData,
      recipient,
      resendBroadcastId,
      resendEmailId,
      occurredAt,
    });

    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
