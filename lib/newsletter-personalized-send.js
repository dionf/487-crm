import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  assertUniqueNewsletterRecipients,
  getConfiguredResend,
  markCampaignFailed,
  normalizeEmail,
  recordNewsletterEvent,
  resendErrorMessage,
  syncRecipientSnapshot,
} from "@/lib/newsletters";
import {
  fetchCampaignCompanies,
  fetchCampaignItems,
  fetchCampaignPersonalizations,
  summarizeCompanyApproval,
} from "@/lib/newsletter-personalize";
import { renderPersonalizedNewsletter } from "@/lib/newsletter-render";
import { buildUnsubscribeUrl, previewUnsubscribeUrl } from "@/lib/newsletter-unsubscribe";

// Resend accepteert maximaal 100 mails per batch-call.
const RESEND_BATCH_LIMIT = 100;

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&zwnj;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

async function loadCampaignContent(tenant, campaign) {
  const [companies, items, slots] = await Promise.all([
    fetchCampaignCompanies(tenant, campaign),
    fetchCampaignItems(tenant, campaign.id),
    fetchCampaignPersonalizations(tenant, campaign.id),
  ]);
  return { companies, items, slots };
}

// Bedrijven die nog niet volledig zijn goedgekeurd; leeg = klaar om te verzenden.
export function openApprovals(companies, slots) {
  return companies
    .filter((company) => summarizeCompanyApproval(company, slots) !== "approved")
    .map((company) => company.company_name || company.id);
}

// Testmail: de gepersonaliseerde versie van één bedrijf naar één testadres.
export async function sendPersonalizedTestEmail({ tenant, campaign, leadId, toEmail, userName }) {
  const email = normalizeEmail(toEmail);
  if (!email) throw new Error("Geldig testadres is verplicht");
  let data;
  let company;
  try {
    const { companies, items, slots } = await loadCampaignContent(tenant, campaign);
    if (!items.length) throw new Error("Voeg eerst items toe aan de nieuwsbrief");
    company = leadId ? companies.find((candidate) => candidate.id === leadId) : companies[0];
    if (!company) throw new Error("Geen ontvangend bedrijf gevonden voor de testmail");

    const rendered = renderPersonalizedNewsletter({
      campaign,
      items,
      slots: slots.filter((slot) => slot.lead_id === company.id),
      company,
      recipient: company.recipients[0],
      unsubscribeUrl: previewUnsubscribeUrl(),
    });
    const { resend, settings, from } = await getConfiguredResend(tenant);
    const result = await resend.emails.send({
      from,
      to: [email],
      replyTo: settings.reply_to,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      text: htmlToText(rendered.html),
    });
    if (result.error) throw new Error(resendErrorMessage(result.error));
    data = result.data;
  } catch (error) {
    await recordNewsletterEvent({
      tenant,
      campaign_id: campaign.id,
      event_type: "test_failed",
      email,
      payload: { error: error.message, sent_by: userName, lead_id: leadId || null },
    });
    throw error;
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("newsletter_campaigns")
    .update({ status: "tested", test_sent_at: now, updated_at: now })
    .eq("tenant", tenant)
    .eq("id", campaign.id)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);

  await recordNewsletterEvent({
    tenant,
    campaign_id: campaign.id,
    event_type: "test_sent",
    email,
    resend_email_id: data?.id || null,
    payload: { sent_by: userName, lead_id: company.id, company_name: company.company_name },
  });
  return updated;
}

// Verstuurt elke ontvanger een eigen mail via resend.batch.send.
// Geen broadcast, dus ook geen Resend-segment of -contacten nodig.
export async function sendPersonalizedCampaign({ tenant, campaign, userName }) {
  if (campaign.batch_mode === "automatic") {
    throw new Error("Gepersonaliseerde campagnes ondersteunen nog geen automatische batches; kies verzenden in één keer");
  }
  if (campaign.scheduled_at) {
    throw new Error("Inplannen kan nog niet bij gepersonaliseerde campagnes; maak de verzendtijd leeg");
  }
  if (!campaign.test_sent_at) throw new Error("Stuur eerst een testmail");

  // Nooit opnieuw versturen naar een eerdere (deels) gelukte poging.
  const { count: alreadySent, error: sentError } = await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("tenant", tenant)
    .eq("campaign_id", campaign.id)
    .not("resend_email_id", "is", null);
  if (sentError) throw new Error(sentError.message);
  if (alreadySent) {
    throw new Error(`Deze campagne is al naar ${alreadySent} ontvanger(s) verstuurd; opnieuw verzenden is geblokkeerd`);
  }

  const { companies, items, slots } = await loadCampaignContent(tenant, campaign);
  if (!items.length) throw new Error("Voeg eerst items toe aan de nieuwsbrief");
  if (!companies.length) throw new Error("Geen ontvangers gevonden");
  const open = openApprovals(companies, slots);
  if (open.length) {
    throw new Error(`Nog niet goedgekeurd: ${open.join(", ")}`);
  }

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const recipients = companies.flatMap((company) => company.recipients);
  assertUniqueNewsletterRecipients(recipients, "Gepersonaliseerde verzending");

  let snapshot = [];
  let sentCount = 0;
  try {
    const { resend, settings, from } = await getConfiguredResend(tenant);
    snapshot = await syncRecipientSnapshot(tenant, campaign.id, recipients);
    await supabaseAdmin
      .from("newsletter_campaigns")
      .update({ status: "syncing", recipient_count: snapshot.length, updated_at: new Date().toISOString() })
      .eq("tenant", tenant)
      .eq("id", campaign.id);

    const emails = snapshot.map((recipient) => {
      const company = companyById.get(recipient.lead_id);
      const unsubscribeUrl = buildUnsubscribeUrl(recipient.id);
      const rendered = renderPersonalizedNewsletter({
        campaign,
        items,
        slots: slots.filter((slot) => slot.lead_id === recipient.lead_id),
        company,
        recipient,
        unsubscribeUrl,
      });
      return {
        recipient,
        payload: {
          from,
          to: [recipient.email],
          replyTo: settings.reply_to,
          subject: rendered.subject,
          html: rendered.html,
          text: htmlToText(rendered.html),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: [{ name: "campaign_id", value: campaign.id }],
        },
      };
    });

    for (let start = 0; start < emails.length; start += RESEND_BATCH_LIMIT) {
      const chunk = emails.slice(start, start + RESEND_BATCH_LIMIT);
      const result = await resend.batch.send(
        chunk.map((email) => email.payload),
        { idempotencyKey: `campaign-${campaign.id}-${start}` }
      );
      if (result.error) throw new Error(resendErrorMessage(result.error));
      const ids = result.data?.data || [];
      if (ids.length !== chunk.length) throw new Error("Resend gaf niet voor elke mail een ID terug");

      const now = new Date().toISOString();
      for (let index = 0; index < chunk.length; index += 1) {
        await supabaseAdmin
          .from("newsletter_campaign_recipients")
          .update({ status: "sent", resend_email_id: ids[index].id, updated_at: now })
          .eq("tenant", tenant)
          .eq("id", chunk[index].recipient.id);
      }
      sentCount += chunk.length;
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("newsletter_campaigns")
      .update({
        status: "sent",
        recipient_count: snapshot.length,
        approved_at: now,
        approved_by: userName,
        sent_at: now,
        updated_at: now,
      })
      .eq("tenant", tenant)
      .eq("id", campaign.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    await recordNewsletterEvent({
      tenant,
      campaign_id: campaign.id,
      event_type: "personalized_sent",
      payload: { recipient_count: snapshot.length, company_count: companies.length, sent_by: userName },
    });
    return updated;
  } catch (error) {
    await markCampaignFailed({
      tenant,
      campaignId: campaign.id,
      error,
      userName,
      payload: { mode: "personalized", recipient_count: snapshot.length, sent_count: sentCount },
    });
    throw error;
  }
}
