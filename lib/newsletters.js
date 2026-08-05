import { Resend } from "resend";
import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret, encryptSecret, secretLast4 } from "@/lib/newsletter-crypto";

const BLOCKED_MARKETING_STATUSES = new Set(["unsubscribed", "hard_bounce", "non_marketing"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
const CONTACT_BATCH_SIZE = 100;
const SUPPRESSION_BATCH_SIZE = 500;
export const MAX_RECIPIENT_LIMIT = 100000;

export function requireAdmin(request) {
  const session = getVerifiedSession(request);
  if (!session) throw Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.role !== "admin") throw Response.json({ error: "Alleen admins" }, { status: 403 });
  return {
    tenant: session.tenant,
    role: session.role,
    userId: session.user_id,
    userName: session.name || "CRM",
  };
}

export function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return EMAIL_RE.test(value) ? value : "";
}

function recipientEmailKey(recipient) {
  return normalizeEmail(recipient?.email);
}

async function fetchSuppressedNewsletterEmails(tenant, emails = []) {
  const uniqueEmails = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const suppressed = new Set();
  for (let i = 0; i < uniqueEmails.length; i += SUPPRESSION_BATCH_SIZE) {
    const batch = uniqueEmails.slice(i, i + SUPPRESSION_BATCH_SIZE);
    if (!batch.length) continue;
    const { data, error } = await supabaseAdmin
      .from("newsletter_email_suppressions")
      .select("email, status")
      .eq("tenant", tenant)
      .in("email", batch);
    if (error) {
      if (isMissingNewsletterTable(error)) return suppressed;
      throw new Error(error.message);
    }
    for (const row of data || []) {
      if (BLOCKED_MARKETING_STATUSES.has(row.status)) suppressed.add(normalizeEmail(row.email));
    }
  }
  return suppressed;
}

export function auditRecipientUniqueness(recipients = []) {
  const counts = new Map();
  let invalid_count = 0;
  for (const recipient of recipients || []) {
    const email = recipientEmailKey(recipient);
    if (!email) {
      invalid_count += 1;
      continue;
    }
    counts.set(email, (counts.get(email) || 0) + 1);
  }
  const duplicate_emails = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([email, count]) => ({ email, count }))
    .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));

  return {
    invalid_count,
    unique_count: counts.size,
    duplicate_address_count: duplicate_emails.length,
    duplicate_extra_count: duplicate_emails.reduce((sum, item) => sum + item.count - 1, 0),
    duplicate_emails,
  };
}

export function assertUniqueNewsletterRecipients(recipients = [], context = "nieuwsbriefontvangers") {
  const audit = auditRecipientUniqueness(recipients);
  if (audit.invalid_count > 0) {
    throw new Error(`${context}: ${audit.invalid_count} ongeldig(e) e-mailadres(sen) gevonden`);
  }
  if (audit.duplicate_address_count > 0) {
    const examples = audit.duplicate_emails.slice(0, 5).map((item) => `${item.email} (${item.count}x)`).join(", ");
    throw new Error(`${context}: dubbele e-mailadressen gevonden; verzending geblokkeerd. ${examples}`);
  }
  if (audit.unique_count !== recipients.length) {
    throw new Error(`${context}: ontvangers zijn niet uniek; verzending geblokkeerd`);
  }
  return audit;
}

export function sanitizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeRecipientLimit(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Maximaal aantal ontvangers moet leeg zijn of minimaal 1");
  }
  if (parsed > MAX_RECIPIENT_LIMIT) {
    throw new Error(`Maximaal aantal ontvangers mag niet hoger zijn dan ${MAX_RECIPIENT_LIMIT}`);
  }
  return parsed;
}

export function isMissingNewsletterTable(error) {
  const message = String(error?.message || "");
  return MISSING_TABLE_CODES.has(error?.code) || /newsletter_.*schema cache|relation .*newsletter_/i.test(message);
}

export function missingNewsletterSetupResponse() {
  return Response.json(
    {
      error: "Nieuwsbrief-tabellen ontbreken nog. Draai eerst migrations/016_multi_tenant_newsletters.sql.",
      setup_required: true,
    },
    { status: 409 }
  );
}

function redactSettings(row) {
  if (!row) return null;
  const apiKeyValid = row.resend_api_key_encrypted ? canDecryptSecret(row.resend_api_key_encrypted) : null;
  const webhookSecretValid = row.resend_webhook_secret_encrypted ? canDecryptSecret(row.resend_webhook_secret_encrypted) : null;
  return {
    tenant: row.tenant,
    from_name: row.from_name || "",
    from_email: row.from_email || "",
    reply_to: row.reply_to || "",
    domain_status: row.domain_status || "",
    has_api_key: Boolean(row.resend_api_key_encrypted),
    api_key_valid: apiKeyValid,
    api_key_last4: row.resend_api_key_last4 || null,
    has_webhook_secret: Boolean(row.resend_webhook_secret_encrypted),
    webhook_secret_valid: webhookSecretValid,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function canDecryptSecret(value) {
  try {
    decryptSecret(value);
    return true;
  } catch {
    return false;
  }
}

async function getNewsletterSettingsRow(tenant) {
  const { data, error } = await supabaseAdmin
    .from("newsletter_settings")
    .select("*")
    .eq("tenant", tenant)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getNewsletterSettings(tenant, { revealSecrets = false } = {}) {
  const data = await getNewsletterSettingsRow(tenant);
  if (!revealSecrets) return redactSettings(data);
  if (!data) return null;
  return {
    ...data,
    resend_api_key: decryptSecret(data.resend_api_key_encrypted),
    resend_webhook_secret: data.resend_webhook_secret_encrypted
      ? decryptSecret(data.resend_webhook_secret_encrypted)
      : null,
  };
}

export async function upsertNewsletterSettings(tenant, body) {
  const current = await getNewsletterSettingsRow(tenant);
  const patch = {
    tenant,
    from_name: body.from_name || current?.from_name || null,
    from_email: normalizeEmail(body.from_email) || current?.from_email || null,
    reply_to: normalizeEmail(body.reply_to) || normalizeEmail(body.from_email) || current?.reply_to || null,
    domain_status: body.domain_status || current?.domain_status || null,
    updated_at: new Date().toISOString(),
  };

  if (body.resend_api_key) {
    patch.resend_api_key_encrypted = encryptSecret(String(body.resend_api_key).trim());
    patch.resend_api_key_last4 = secretLast4(body.resend_api_key);
  } else if (current?.resend_api_key_encrypted) {
    patch.resend_api_key_encrypted = current.resend_api_key_encrypted;
    patch.resend_api_key_last4 = current.resend_api_key_last4;
  }

  if (body.resend_webhook_secret) {
    patch.resend_webhook_secret_encrypted = encryptSecret(String(body.resend_webhook_secret).trim());
  } else if (current?.resend_webhook_secret_encrypted) {
    patch.resend_webhook_secret_encrypted = current.resend_webhook_secret_encrypted;
  }

  if (!patch.from_name || !patch.from_email || !patch.reply_to) {
    throw new Error("from_name, from_email en reply_to zijn verplicht");
  }

  const { data, error } = await supabaseAdmin
    .from("newsletter_settings")
    .upsert(patch, { onConflict: "tenant" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return redactSettings(data);
}

export async function getConfiguredResend(tenant) {
  const settings = await getNewsletterSettingsRow(tenant);
  if (!settings?.resend_api_key_encrypted || !settings.from_name || !settings.from_email || !settings.reply_to) {
    throw new Error("Nieuwsbriefinstellingen zijn nog niet compleet");
  }
  let resendApiKey;
  try {
    resendApiKey = decryptSecret(settings.resend_api_key_encrypted);
  } catch {
    throw new Error("Resend API-key kan niet worden ontsleuteld. Sla de Resend API-key opnieuw op bij Resend instellingen.");
  }
  return {
    resend: new Resend(resendApiKey),
    settings,
    from: `${settings.from_name} <${settings.from_email}>`,
  };
}

function segmentMatchesLead(segment, lead) {
  if (!segment || segment.source_type === "all_marketing") return true;
  const leadSegments = Array.isArray(lead.marketing_segments) ? lead.marketing_segments : [];
  if (segment.source_type === "marketing_segment") {
    return leadSegments.includes(segment.source_value);
  }
  if (segment.source_type === "without_marketing_segments") {
    const excluded = String(segment.source_value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return excluded.every((item) => !leadSegments.includes(item));
  }
  if (["lead_status", "relationship_type", "hubspot_deal_origin", "industry"].includes(segment.source_type)) {
    const expected = String(segment.source_value || "").trim().toLowerCase();
    const actual = String(lead[segment.source_type === "lead_status" ? "status" : segment.source_type] || "")
      .trim()
      .toLowerCase();
    return Boolean(expected) && actual === expected;
  }
  if (segment.source_type === "recipient_email_contains") return true;
  if (segment.source_type === "recent_order_days") {
    const days = Number(segment.source_value || 14);
    if (!Number.isFinite(days) || days < 1 || !lead.last_order_at) return false;
    const orderedAt = new Date(lead.last_order_at).getTime();
    if (Number.isNaN(orderedAt)) return false;
    return orderedAt >= Date.now() - days * 24 * 60 * 60 * 1000;
  }
  return false;
}

function segmentMatchesRecipient(segment, lead, recipient) {
  if (!segment) return true;
  if (segment.source_type === "recipient_email_in") {
    const email = normalizeEmail(recipient.email);
    const allowedEmails = String(segment.source_value || "")
      .split(/[\n,;]+/)
      .map(normalizeEmail)
      .filter(Boolean);
    return Boolean(email) && allowedEmails.includes(email);
  }
  if (segment.source_type === "recipient_email_contains") {
    const needle = String(segment.source_value || "").trim().toLowerCase();
    if (!needle) return false;
    return String(recipient.email || "").toLowerCase().includes(needle);
  }
  return segmentMatchesLead(segment, lead);
}

function shouldExcludeRecipient(segment, includeSegment, lead, recipient) {
  if (!segment) return false;
  if (segment.default_excluded && segment.source_type === "recipient_email_contains") {
    const needle = String(segment.source_value || "").trim().toLowerCase();
    return Boolean(needle) && [recipient.email, lead.email].some((email) => String(email || "").toLowerCase().includes(needle));
  }
  if (includeSegment?.source_type === "recipient_email_contains" && !segment.default_excluded) {
    return segment.source_type === "recipient_email_contains" && segmentMatchesRecipient(segment, lead, recipient);
  }
  return segmentMatchesRecipient(segment, lead, recipient);
}

function sameSegmentRule(a, b) {
  if (!a || !b) return false;
  return (
    a.source_type === b.source_type &&
    String(a.source_value || "").trim().toLowerCase() === String(b.source_value || "").trim().toLowerCase()
  );
}

function normalizeSegmentIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
}

async function getActiveNewsletterSegments(tenant) {
  const { data, error } = await supabaseAdmin
    .from("newsletter_segments")
    .select("*")
    .eq("tenant", tenant)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return data || [];
}

async function resolveCampaignSegments(tenant, segmentId, excludedSegmentIds = []) {
  const segments = await getActiveNewsletterSegments(tenant);
  const includeSegment = segmentId ? segments.find((segment) => segment.id === segmentId) : null;
  if (segmentId && !includeSegment) throw new Error("Segment niet gevonden");

  const explicitExcluded = new Set(normalizeSegmentIds(excludedSegmentIds));
  return {
    includeSegment,
    excludedSegments: segments.filter((segment) => {
      if (segment.id === includeSegment?.id) return false;
      if (sameSegmentRule(segment, includeSegment)) return false;
      if (segment.source_type === "all_marketing") return false;
      return segment.default_excluded || explicitExcluded.has(segment.id);
    }),
  };
}

function contactNameParts(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || undefined,
    lastName: parts.slice(1).join(" ") || undefined,
  };
}

export async function getCampaignForTenant(tenant, id) {
  const { data, error } = await supabaseAdmin
    .from("newsletter_campaigns")
    .select("*, newsletter_segments(id, name, slug, source_type, source_value)")
    .eq("tenant", tenant)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function buildRecipientsForCampaign(tenant, segmentId, excludedSegmentIds = [], recipientLimit = null) {
  const { includeSegment, excludedSegments } = await resolveCampaignSegments(tenant, segmentId, excludedSegmentIds);
  const limit = normalizeRecipientLimit(recipientLimit);

  const { data: leads, error: leadError } = await supabaseAdmin
    .from("leads")
    .select("id, tenant, company_name, contact_person, contact_first_name, contact_last_name, email, status, relationship_type, hubspot_deal_origin, industry, last_order_at, marketing_consent, marketing_segments, marketing_subscription_status, marketing_hard_bounced")
    .eq("tenant", tenant)
    .eq("marketing_consent", true);
  if (leadError) throw new Error(leadError.message);

  const eligibleLeads = (leads || []).filter((lead) => {
    if (lead.marketing_hard_bounced) return false;
    if (BLOCKED_MARKETING_STATUSES.has(lead.marketing_subscription_status)) return false;
    return segmentMatchesLead(includeSegment, lead);
  });

  const leadIds = eligibleLeads.map((lead) => lead.id);
  const contactsByLead = new Map();
  for (let i = 0; i < leadIds.length; i += CONTACT_BATCH_SIZE) {
    const ids = leadIds.slice(i, i + CONTACT_BATCH_SIZE);
    if (!ids.length) continue;
    const { data: contacts, error } = await supabaseAdmin
      .from("contacts")
      .select("id, lead_id, name, email, marketing_consent")
      .eq("tenant", tenant)
      .in("lead_id", ids);
    if (error) throw new Error(error.message);
    for (const contact of contacts || []) {
      if (!contactsByLead.has(contact.lead_id)) contactsByLead.set(contact.lead_id, []);
      contactsByLead.get(contact.lead_id).push(contact);
    }
  }

  const recipients = new Map();
  const candidates = [];
  let candidate_count = 0;
  let duplicate_candidate_count = 0;
  let suppressed_count = 0;
  const duplicateCandidateEmails = new Map();
  for (const lead of eligibleLeads) {
    const leadCandidates = [
      ...(contactsByLead.get(lead.id) || []).map((contact) => ({
        lead_id: lead.id,
        contact_id: contact.id,
        email: contact.email,
        name: contact.name,
        company_name: lead.company_name,
      })),
      {
        lead_id: lead.id,
        contact_id: null,
        email: lead.email,
        name: lead.contact_person || [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" "),
        company_name: lead.company_name,
      },
    ];

    for (const candidate of leadCandidates) {
      const email = normalizeEmail(candidate.email);
      if (!email) continue;
      const recipient = { ...candidate, email };
      if (includeSegment && !segmentMatchesRecipient(includeSegment, lead, recipient)) continue;
      if (excludedSegments.some((segment) => shouldExcludeRecipient(segment, includeSegment, lead, recipient))) continue;
      candidate_count += 1;
      candidates.push({ ...candidate, email });
    }
  }

  const suppressedEmails = await fetchSuppressedNewsletterEmails(
    tenant,
    candidates.map((candidate) => candidate.email)
  );
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email);
    if (!email) continue;
    if (suppressedEmails.has(email)) {
      suppressed_count += 1;
      continue;
    }
    if (recipients.has(email)) {
      duplicate_candidate_count += 1;
      duplicateCandidateEmails.set(email, (duplicateCandidateEmails.get(email) || 1) + 1);
      continue;
    }
    recipients.set(email, { ...candidate, email });
  }

  const allRecipients = [...recipients.values()].sort((a, b) => a.email.localeCompare(b.email));
  const limitedRecipients = limit ? allRecipients.slice(0, limit) : allRecipients;
  assertUniqueNewsletterRecipients(allRecipients, "Nieuwsbriefpreview");
  return {
    recipients: limitedRecipients,
    total_count: allRecipients.length,
    candidate_count,
    suppressed_count,
    deduplicated_count: duplicate_candidate_count,
    duplicate_address_count: duplicateCandidateEmails.size,
    duplicate_emails: [...duplicateCandidateEmails.entries()]
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email))
      .slice(0, 50),
    limit,
    limited: Boolean(limit && allRecipients.length > limitedRecipients.length),
  };
}

export function ensureUnsubscribeLink(html) {
  const body = String(html || "");
  if (body.includes("{{{RESEND_UNSUBSCRIBE_URL}}}")) return body;
  return `${body}
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#6b7280;">
  Je ontvangt deze mail omdat je bent ingeschreven voor updates. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#d97706;">Afmelden</a>.
</div>`;
}

function escapeHtmlText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePreviewText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hiddenPreviewPreheader(previewText) {
  const text = normalizePreviewText(previewText);
  if (!text) return "";
  const spacer = "&nbsp;&zwnj;".repeat(40);
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">${escapeHtmlText(text)}</div>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">${spacer}</div>`;
}

export function injectPreviewPreheader(html, previewText) {
  const preheader = hiddenPreviewPreheader(previewText);
  const body = String(html || "");
  if (!preheader) return body;
  if (/<body\b[^>]*>/i.test(body)) {
    return body.replace(/<body\b[^>]*>/i, (match) => `${match}\n${preheader}`);
  }
  return `${preheader}\n${body}`;
}

function campaignHtml(campaign) {
  return ensureUnsubscribeLink(injectPreviewPreheader(campaign.body_html, campaign.preview_text));
}

function resendErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || error.name || error.error || JSON.stringify(error);
}

async function recordNewsletterEvent(row) {
  const { error } = await supabaseAdmin.from("newsletter_events").insert(row);
  if (error) console.warn("Kon nieuwsbrief-event niet opslaan", error.message);
}

async function recordBroadcastSentOnce({ tenant, campaignId, broadcastId, payload }) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("newsletter_events")
    .select("id")
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId)
    .eq("event_type", "broadcast_sent")
    .eq("resend_broadcast_id", broadcastId)
    .maybeSingle();
  if (existingError) {
    console.warn("Kon bestaande broadcast_sent-event niet controleren", existingError.message);
    return;
  }
  if (existing) return;

  await recordNewsletterEvent({
    tenant,
    campaign_id: campaignId,
    event_type: "broadcast_sent",
    resend_broadcast_id: broadcastId,
    payload,
  });
}

async function markCampaignFailed({ tenant, campaignId, error, userName, payload = {} }) {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("newsletter_campaigns")
    .update({ status: "failed", updated_at: now })
    .eq("tenant", tenant)
    .eq("id", campaignId)
    .not("status", "in", "(sent,scheduled)");

  await recordNewsletterEvent({
    tenant,
    campaign_id: campaignId,
    event_type: "broadcast_failed",
    payload: {
      ...payload,
      error: error.message,
      sent_by: userName,
    },
  });
}

async function syncRecipientSnapshot(tenant, campaignId, recipients) {
  assertUniqueNewsletterRecipients(recipients, "Nieuwsbriefsnapshot voor opslaan");

  await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .delete()
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId);

  if (!recipients.length) return [];
  const rows = recipients.map((recipient) => ({
    tenant,
    campaign_id: campaignId,
    lead_id: recipient.lead_id,
    contact_id: recipient.contact_id,
    email: normalizeEmail(recipient.email),
    name: recipient.name || null,
    company_name: recipient.company_name || null,
    status: "planned",
  }));
  const { data, error } = await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .insert(rows)
    .select("*");
  if (error) throw new Error(error.message);
  const snapshot = data || [];
  assertUniqueNewsletterRecipients(snapshot, "Nieuwsbriefsnapshot na opslaan");
  if (snapshot.length !== recipients.length) {
    throw new Error("Nieuwsbriefsnapshot wijkt af van de unieke ontvangerlijst; verzending geblokkeerd");
  }
  return snapshot;
}

export async function sendTestEmail({ tenant, campaign, toEmail, userName }) {
  const email = normalizeEmail(toEmail);
  if (!email) throw new Error("Geldig testadres is verplicht");
  let data;
  try {
    const { resend, settings, from } = await getConfiguredResend(tenant);
    const result = await resend.emails.send({
      from,
      to: [email],
      replyTo: settings.reply_to,
      subject: `[TEST] ${campaign.subject}`,
      html: campaignHtml(campaign).replaceAll("{{{RESEND_UNSUBSCRIBE_URL}}}", "https://resend.com"),
      text: campaign.preview_text || undefined,
    });
    if (result.error) throw new Error(resendErrorMessage(result.error));
    data = result.data;
  } catch (error) {
    await recordNewsletterEvent({
      tenant,
      campaign_id: campaign.id,
      event_type: "test_failed",
      email,
      payload: { error: error.message, sent_by: userName },
    });
    throw error;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("newsletter_campaigns")
    .update({
      status: "tested",
      test_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
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
    payload: { sent_by: userName },
  });

  return updated;
}

export async function syncAndSendCampaign({ tenant, campaign, userName }) {
  const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at).toISOString() : null;
  const isScheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  if (scheduledAt && !isScheduled) {
    throw new Error("De geplande verzendtijd ligt in het verleden. Kies een nieuwe toekomstige tijd of maak de verzendtijd leeg voor direct verzenden.");
  }

  let snapshot = [];
  let resendSegmentId = null;
  let broadcastId = null;
  try {
    if (!campaign.test_sent_at) throw new Error("Stuur eerst een testmail");
    const { resend, settings, from } = await getConfiguredResend(tenant);
    const recipientResult = await buildRecipientsForCampaign(
      tenant,
      campaign.segment_id,
      campaign.excluded_segment_ids,
      campaign.recipient_limit
    );
    const recipients = recipientResult.recipients;
    if (!recipients.length) throw new Error("Geen ontvangers gevonden");
    assertUniqueNewsletterRecipients(recipients, "Nieuwsbriefverzending");

    snapshot = await syncRecipientSnapshot(tenant, campaign.id, recipients);
    await supabaseAdmin
      .from("newsletter_campaigns")
      .update({ status: "syncing", recipient_count: snapshot.length, updated_at: new Date().toISOString() })
      .eq("tenant", tenant)
      .eq("id", campaign.id);

    const segmentName = `CRM ${campaign.name} ${campaign.id.slice(0, 8)}`;
    const { data: segmentData, error: segmentError } = await resend.segments.create({ name: segmentName });
    if (segmentError) throw new Error(resendErrorMessage(segmentError));
    resendSegmentId = segmentData?.id;
    if (!resendSegmentId) throw new Error("Resend segment-ID ontbreekt");

    for (const recipient of snapshot) {
      const { firstName, lastName } = contactNameParts(recipient.name);
      const contactPayload = {
        email: recipient.email,
        firstName,
        lastName,
        unsubscribed: false,
      };
      const created = await resend.contacts.create(contactPayload);
      let resendContactId = created.data?.id || null;
      if (created.error) {
        const existing = await resend.contacts.get({ email: recipient.email });
        if (existing.error) throw new Error(resendErrorMessage(created.error));
        resendContactId = existing.data?.id || null;
        const updated = await resend.contacts.update({ ...contactPayload, id: resendContactId });
        if (updated.error) throw new Error(resendErrorMessage(updated.error));
      }
      if (!resendContactId) throw new Error("Resend contact-ID ontbreekt");
      const added = await resend.contacts.segments.add({ contactId: resendContactId, segmentId: resendSegmentId });
      if (added.error) throw new Error(resendErrorMessage(added.error));
      await supabaseAdmin
        .from("newsletter_campaign_recipients")
        .update({
          status: "synced",
          resend_contact_id: resendContactId,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant", tenant)
        .eq("id", recipient.id);
    }

    const createdBroadcast = await resend.broadcasts.create({
      name: campaign.name,
      segmentId: resendSegmentId,
      from,
      replyTo: settings.reply_to,
      subject: campaign.subject,
      html: campaignHtml(campaign),
    });
    if (createdBroadcast.error) throw new Error(resendErrorMessage(createdBroadcast.error));
    broadcastId = createdBroadcast.data?.id;
    if (!broadcastId) throw new Error("Resend broadcast-ID ontbreekt");

    const sent = await resend.broadcasts.send(
      broadcastId,
      isScheduled ? { scheduledAt } : undefined
    );
    if (sent.error) throw new Error(resendErrorMessage(sent.error));

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("newsletter_campaigns")
      .update({
        status: isScheduled ? "scheduled" : "sent",
        recipient_count: snapshot.length,
        resend_segment_id: resendSegmentId,
        resend_broadcast_id: broadcastId,
        approved_at: now,
        approved_by: userName,
        sent_at: isScheduled ? null : now,
        scheduled_at: scheduledAt,
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
      event_type: isScheduled ? "broadcast_scheduled" : "broadcast_sent",
      resend_broadcast_id: broadcastId,
      payload: {
        recipient_count: snapshot.length,
        total_recipient_count: recipientResult.total_count,
        recipient_limit: recipientResult.limit,
        sent_by: userName,
        scheduled_at: scheduledAt,
        resend_response: sent.data || null,
      },
    });

    return updated;
  } catch (error) {
    await markCampaignFailed({
      tenant,
      campaignId: campaign.id,
      error,
      userName,
      payload: {
        recipient_count: snapshot.length,
        resend_segment_id: resendSegmentId,
        resend_broadcast_id: broadcastId,
      },
    });
    throw error;
  }
}

export async function reconcileScheduledBroadcasts(tenant, campaigns = []) {
  const scheduledCampaigns = (campaigns || []).filter(
    (campaign) => campaign.status === "scheduled" && campaign.resend_broadcast_id
  );
  if (!scheduledCampaigns.length) return campaigns || [];

  let resend;
  try {
    ({ resend } = await getConfiguredResend(tenant));
  } catch (error) {
    console.warn("Kon geplande nieuwsbrieven niet controleren bij Resend", error.message);
    return campaigns || [];
  }

  const reconciled = new Map();
  for (const campaign of scheduledCampaigns) {
    try {
      const result = await resend.broadcasts.get(campaign.resend_broadcast_id);
      if (result.error) throw new Error(resendErrorMessage(result.error));
      const broadcast = result.data || {};
      if (broadcast.status !== "sent") continue;

      const sentAt = new Date(broadcast.sent_at || broadcast.sentAt || Date.now()).toISOString();
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("newsletter_campaigns")
        .update({
          status: "sent",
          sent_at: sentAt,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant", tenant)
        .eq("id", campaign.id)
        .eq("resend_broadcast_id", campaign.resend_broadcast_id)
        .eq("status", "scheduled")
        .select("*")
        .single();
      if (updateError) throw new Error(updateError.message);

      await supabaseAdmin
        .from("newsletter_campaign_recipients")
        .update({
          status: "sent",
          last_event_at: sentAt,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant", tenant)
        .eq("campaign_id", campaign.id)
        .eq("status", "synced");

      await recordBroadcastSentOnce({
        tenant,
        campaignId: campaign.id,
        broadcastId: campaign.resend_broadcast_id,
        payload: {
          source: "resend_reconcile",
          resend_status: broadcast.status,
          sent_at: broadcast.sent_at || broadcast.sentAt || sentAt,
        },
      });
      reconciled.set(campaign.id, updated);
    } catch (error) {
      console.warn(`Kon nieuwsbriefcampagne ${campaign.id} niet controleren bij Resend`, error.message);
    }
  }

  return (campaigns || []).map((campaign) => reconciled.get(campaign.id) || campaign);
}
