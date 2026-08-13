import { Resend } from "resend";
import { resolveTxt } from "node:dns/promises";
import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret, encryptSecret, secretLast4 } from "@/lib/newsletter-crypto";

const BLOCKED_MARKETING_STATUSES = new Set(["unsubscribed", "hard_bounce", "non_marketing"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
const CONTACT_BATCH_SIZE = 100;
const SUPPRESSION_BATCH_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_WAIT_HOURS = 4;
const HEALTH_EVENT_TYPES = {
  delivered: new Set(["email.delivered"]),
  bounced: new Set(["email.bounced"]),
  complained: new Set(["email.complained"]),
  failed: new Set(["email.failed", "email.suppressed", "suppression.added"]),
  unsubscribed: new Set(["contact.updated"]),
};
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
    resendApiKey,
    settings,
    from: `${settings.from_name} <${settings.from_email}>`,
  };
}

function normalizeRate(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error("Batchdrempels moeten tussen 0 en 1 liggen");
  return parsed;
}

export function normalizeBatchSize(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Batchgrootte moet leeg zijn of minimaal 1");
  if (parsed > MAX_RECIPIENT_LIMIT) throw new Error(`Batchgrootte mag niet hoger zijn dan ${MAX_RECIPIENT_LIMIT}`);
  return parsed;
}

export function normalizeBatchSettings(body = {}) {
  const batchMode = body.batch_mode === "automatic" ? "automatic" : "single";
  const waitHours = Number(body.batch_wait_hours || DEFAULT_BATCH_WAIT_HOURS);
  if (!Number.isFinite(waitHours) || waitHours < 0.25) {
    throw new Error("Wachttijd tussen batches moet minimaal 0,25 uur zijn");
  }
  return {
    batch_mode: batchMode,
    batch_size: batchMode === "automatic"
      ? (normalizeBatchSize(body.batch_size) || DEFAULT_BATCH_SIZE)
      : normalizeBatchSize(body.batch_size),
    batch_wait_hours: waitHours,
    max_bounce_rate: normalizeRate(body.max_bounce_rate, 0.02),
    max_complaint_rate: normalizeRate(body.max_complaint_rate, 0),
    max_failed_rate: normalizeRate(body.max_failed_rate, 0.03),
    max_unsubscribe_rate: normalizeRate(body.max_unsubscribe_rate, 0.05),
  };
}

function fromEmailDomain(settings) {
  const email = normalizeEmail(settings?.from_email);
  return email.split("@")[1] || "";
}

async function resendApi(resendApiKey, path, options = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `Resend API fout ${res.status}`);
  return data;
}

function domainMatches(emailDomain, resendDomain) {
  return emailDomain === resendDomain || emailDomain.endsWith(`.${resendDomain}`);
}

function recordOk(record) {
  return ["verified", "success", "ok"].includes(String(record?.status || "").toLowerCase());
}

async function hasDmarcRecord(domain) {
  const candidates = [domain];
  const parts = domain.split(".");
  if (parts.length > 2) candidates.push(parts.slice(-2).join("."));
  for (const candidate of [...new Set(candidates)]) {
    try {
      const records = await resolveTxt(`_dmarc.${candidate}`);
      const flat = records.map((items) => items.join("")).join(" ");
      if (/v=DMARC1/i.test(flat)) return { ok: true, domain: candidate, record: flat };
    } catch {
      // Try parent domain.
    }
  }
  return { ok: false, domain, record: null };
}

export async function checkNewsletterDomainHealth(tenant) {
  const { settings, resendApiKey } = await getConfiguredResend(tenant);
  const emailDomain = fromEmailDomain(settings);
  if (!emailDomain) throw new Error("Afzenderdomein ontbreekt");

  const domains = await resendApi(resendApiKey, "/domains?limit=100");
  const matchingDomain = (domains.data || []).find((domain) => domainMatches(emailDomain, domain.name));
  if (!matchingDomain) {
    return {
      ok: false,
      domain: emailDomain,
      reason: "Afzenderdomein niet gevonden in Resend",
      resend_domain: null,
      dmarc: await hasDmarcRecord(emailDomain),
      checked_at: new Date().toISOString(),
    };
  }

  const details = await resendApi(resendApiKey, `/domains/${matchingDomain.id}`);
  const records = details.records || [];
  const dmarc = await hasDmarcRecord(emailDomain);
  const sendingEnabled = details.capabilities?.sending === "enabled";
  const domainVerified = ["verified", "completed"].includes(String(details.status || "").toLowerCase());
  const hasVerifiedSpf = records.some((record) => String(record.record || "").toUpperCase() === "SPF" && recordOk(record));
  const hasVerifiedDkim = records.some((record) => String(record.record || "").toUpperCase() === "DKIM" && recordOk(record));
  const ok = Boolean(sendingEnabled && domainVerified && hasVerifiedSpf && hasVerifiedDkim && dmarc.ok);

  return {
    ok,
    domain: emailDomain,
    reason: ok ? null : "Resend domein, SPF/DKIM of DMARC is niet volledig groen",
    resend_domain: {
      id: details.id,
      name: details.name,
      status: details.status,
      capabilities: details.capabilities,
      records: records.map((record) => ({
        record: record.record,
        name: record.name,
        type: record.type,
        status: record.status,
      })),
    },
    checks: {
      sending_enabled: sendingEnabled,
      domain_verified: domainVerified,
      spf_verified: hasVerifiedSpf,
      dkim_verified: hasVerifiedDkim,
      dmarc_present: dmarc.ok,
    },
    dmarc,
    checked_at: new Date().toISOString(),
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
  if (["recipient_email_in", "recipient_email_contains"].includes(segment.source_type)) return true;
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

async function resolveCampaignSegments(tenant, segmentId, excludedSegmentIds = [], includedSegmentIds = []) {
  const segments = await getActiveNewsletterSegments(tenant);
  const requestedIncludedIds = normalizeSegmentIds(includedSegmentIds);
  const effectiveIncludedIds = requestedIncludedIds.length ? requestedIncludedIds : normalizeSegmentIds(segmentId ? [segmentId] : []);
  const includeSegments = effectiveIncludedIds
    .map((id) => segments.find((segment) => segment.id === id))
    .filter(Boolean);
  if (effectiveIncludedIds.length !== includeSegments.length) throw new Error("Een of meer doelgroepen zijn niet gevonden");

  const explicitExcluded = new Set(normalizeSegmentIds(excludedSegmentIds));
  return {
    includeSegment: includeSegments[0] || null,
    includeSegments,
    excludedSegments: segments.filter((segment) => {
      if (includeSegments.some((includeSegment) => segment.id === includeSegment.id || sameSegmentRule(segment, includeSegment))) return false;
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

export async function buildRecipientsForCampaign(tenant, segmentId, excludedSegmentIds = [], recipientLimit = null, includedSegmentIds = []) {
  const { includeSegment, includeSegments, excludedSegments } = await resolveCampaignSegments(
    tenant,
    segmentId,
    excludedSegmentIds,
    includedSegmentIds
  );
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
    if (!includeSegments.length) return segmentMatchesLead(includeSegment, lead);
    return includeSegments.some((segment) => segmentMatchesLead(segment, lead));
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
      if (includeSegments.length && !includeSegments.some((segment) => segmentMatchesRecipient(segment, lead, recipient))) continue;
      if (!includeSegments.length && includeSegment && !segmentMatchesRecipient(includeSegment, lead, recipient)) continue;
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

async function syncRecipientSnapshot(tenant, campaignId, recipients, { batchSize = null } = {}) {
  assertUniqueNewsletterRecipients(recipients, "Nieuwsbriefsnapshot voor opslaan");

  await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .delete()
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId);

  if (!recipients.length) return [];
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  const rows = recipients.map((recipient, index) => ({
    tenant,
    campaign_id: campaignId,
    lead_id: recipient.lead_id,
    contact_id: recipient.contact_id,
    email: normalizeEmail(recipient.email),
    name: recipient.name || null,
    company_name: recipient.company_name || null,
    status: "planned",
    batch_number: normalizedBatchSize ? Math.floor(index / normalizedBatchSize) + 1 : null,
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

function batchWaitUntil(hours) {
  return new Date(Date.now() + Number(hours || DEFAULT_BATCH_WAIT_HOURS) * 60 * 60 * 1000).toISOString();
}

function eventHealthRates(counts, recipientCount) {
  const denominator = Math.max(Number(recipientCount || 0), 1);
  return {
    bounce_rate: counts.bounced / denominator,
    complaint_rate: counts.complained / denominator,
    failed_rate: counts.failed / denominator,
    unsubscribe_rate: counts.unsubscribed / denominator,
  };
}

function valueAt(object, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return current[key];
    }, object);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function isTruthyEventValue(value) {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return ["true", "1", "yes", "unsubscribed"].includes(value.trim().toLowerCase());
  return false;
}

function eventCountsForHealthBucket(bucket, event) {
  if (bucket !== "unsubscribed") return HEALTH_EVENT_TYPES[bucket].has(event.event_type);
  if (!HEALTH_EVENT_TYPES.unsubscribed.has(event.event_type)) return false;
  const payload = event.payload?.data || event.payload || {};
  return isTruthyEventValue(valueAt(payload, [
    "data.unsubscribed",
    "data.contact.unsubscribed",
    "data.properties.unsubscribed",
    "unsubscribed",
    "contact.unsubscribed",
    "properties.unsubscribed",
  ]));
}

function isHealthEvent(event) {
  return Object.keys(HEALTH_EVENT_TYPES).some((key) => eventCountsForHealthBucket(key, event));
}

function evaluateBatchHealth(campaign, health, domainHealth) {
  if (!domainHealth?.ok) return domainHealth?.reason || "Domeincheck is niet groen";
  if (!health.event_count) return "Geen Resend webhook-events ontvangen voor de vorige batch";
  if (health.counts.complained > 0 && Number(campaign.max_complaint_rate ?? 0) === 0) {
    return "Er is minimaal 1 spamklacht ontvangen";
  }
  if (health.rates.complaint_rate > Number(campaign.max_complaint_rate ?? 0)) {
    return `Spamklachten te hoog (${(health.rates.complaint_rate * 100).toFixed(2)}%)`;
  }
  if (health.rates.bounce_rate > Number(campaign.max_bounce_rate ?? 0.02)) {
    return `Bouncepercentage te hoog (${(health.rates.bounce_rate * 100).toFixed(2)}%)`;
  }
  if (health.rates.failed_rate > Number(campaign.max_failed_rate ?? 0.03)) {
    return `Mislukt/suppressed te hoog (${(health.rates.failed_rate * 100).toFixed(2)}%)`;
  }
  if (health.rates.unsubscribe_rate > Number(campaign.max_unsubscribe_rate ?? 0.05)) {
    return `Uitschrijfpercentage te hoog (${(health.rates.unsubscribe_rate * 100).toFixed(2)}%)`;
  }
  return null;
}

async function syncRecipientsToResendSegment({ tenant, resend, segmentId, recipients }) {
  for (const recipient of recipients) {
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
    const added = await resend.contacts.segments.add({ contactId: resendContactId, segmentId });
    if (added.error) throw new Error(resendErrorMessage(added.error));
    await supabaseAdmin
      .from("newsletter_campaign_recipients")
      .update({
        status: "synced",
        resend_contact_id: resendContactId,
        resend_segment_id: segmentId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant", tenant)
      .eq("id", recipient.id);
  }
}

async function createAndSendBroadcastForRecipients({
  tenant,
  campaign,
  recipients,
  batchNumber = null,
  scheduledAt = null,
  userName,
}) {
  const { resend, settings, from } = await getConfiguredResend(tenant);
  const segmentName = batchNumber
    ? `CRM ${campaign.name} batch ${batchNumber} ${campaign.id.slice(0, 8)}`
    : `CRM ${campaign.name} ${campaign.id.slice(0, 8)}`;
  const { data: segmentData, error: segmentError } = await resend.segments.create({ name: segmentName });
  if (segmentError) throw new Error(resendErrorMessage(segmentError));
  const resendSegmentId = segmentData?.id;
  if (!resendSegmentId) throw new Error("Resend segment-ID ontbreekt");

  await syncRecipientsToResendSegment({ tenant, resend, segmentId: resendSegmentId, recipients });

  const createdBroadcast = await resend.broadcasts.create({
    name: batchNumber ? `${campaign.name} - batch ${batchNumber}` : campaign.name,
    segmentId: resendSegmentId,
    from,
    replyTo: settings.reply_to,
    subject: campaign.subject,
    html: campaignHtml(campaign),
  });
  if (createdBroadcast.error) throw new Error(resendErrorMessage(createdBroadcast.error));
  const resendBroadcastId = createdBroadcast.data?.id;
  if (!resendBroadcastId) throw new Error("Resend broadcast-ID ontbreekt");

  const sent = await resend.broadcasts.send(
    resendBroadcastId,
    scheduledAt ? { scheduledAt } : undefined
  );
  if (sent.error) throw new Error(resendErrorMessage(sent.error));

  await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .update({
      status: scheduledAt ? "scheduled" : "sent",
      resend_segment_id: resendSegmentId,
      resend_broadcast_id: resendBroadcastId,
      last_event_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant", tenant)
    .eq("campaign_id", campaign.id)
    .eq("resend_segment_id", resendSegmentId);

  await recordNewsletterEvent({
    tenant,
    campaign_id: campaign.id,
    event_type: batchNumber ? "batch_sent" : (scheduledAt ? "broadcast_scheduled" : "broadcast_sent"),
    resend_broadcast_id: resendBroadcastId,
    payload: {
      batch_number: batchNumber,
      recipient_count: recipients.length,
      sent_by: userName,
      scheduled_at: scheduledAt,
      resend_response: sent.data || null,
    },
  });

  return { resendSegmentId, resendBroadcastId, resendResponse: sent.data || null };
}

async function replaceCampaignBatches(tenant, campaignId, totalBatches) {
  await supabaseAdmin
    .from("newsletter_campaign_batches")
    .delete()
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId);
  if (!totalBatches) return;
  const rows = Array.from({ length: totalBatches }, (_, index) => ({
    tenant,
    campaign_id: campaignId,
    batch_number: index + 1,
    status: "queued",
  }));
  const { error } = await supabaseAdmin.from("newsletter_campaign_batches").insert(rows);
  if (error) throw new Error(error.message);
}

async function fetchBatchRecipients(tenant, campaignId, batchNumber) {
  const { data, error } = await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .select("*")
    .eq("tenant", tenant)
    .eq("campaign_id", campaignId)
    .eq("batch_number", batchNumber)
    .order("email", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function sendCampaignBatch({ tenant, campaign, batchNumber, userName }) {
  const recipients = await fetchBatchRecipients(tenant, campaign.id, batchNumber);
  if (!recipients.length) throw new Error(`Batch ${batchNumber} heeft geen ontvangers`);
  const now = new Date().toISOString();
  const { resendSegmentId, resendBroadcastId } = await createAndSendBroadcastForRecipients({
    tenant,
    campaign,
    recipients,
    batchNumber,
    userName,
  });
  const nextRunAt = batchWaitUntil(campaign.batch_wait_hours);

  const { error: batchError } = await supabaseAdmin
    .from("newsletter_campaign_batches")
    .upsert({
      tenant,
      campaign_id: campaign.id,
      batch_number: batchNumber,
      status: "waiting",
      recipient_count: recipients.length,
      resend_segment_id: resendSegmentId,
      resend_broadcast_id: resendBroadcastId,
      sent_at: now,
      next_check_at: nextRunAt,
      updated_at: now,
    }, { onConflict: "tenant,campaign_id,batch_number" });
  if (batchError) throw new Error(batchError.message);

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("newsletter_campaigns")
    .update({
      status: "batch_waiting",
      batch_current_number: batchNumber,
      batch_next_run_at: nextRunAt,
      recipient_count: Number(campaign.recipient_count || 0) + recipients.length,
      resend_segment_id: resendSegmentId,
      resend_broadcast_id: resendBroadcastId,
      sent_at: null,
      updated_at: now,
    })
    .eq("tenant", tenant)
    .eq("id", campaign.id)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);
  return updated;
}

async function markAutomaticBatchFailed({ tenant, campaign, error, batchNumber = null, userName }) {
  const now = new Date().toISOString();
  const message = error?.message || String(error || "Onbekende fout");
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("newsletter_campaigns")
    .update({
      status: "failed",
      batch_pause_reason: message,
      batch_next_run_at: null,
      updated_at: now,
    })
    .eq("tenant", tenant)
    .eq("id", campaign.id)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);

  if (batchNumber) {
    await supabaseAdmin
      .from("newsletter_campaign_batches")
      .update({
        status: "failed",
        pause_reason: message,
        updated_at: now,
      })
      .eq("tenant", tenant)
      .eq("campaign_id", campaign.id)
      .eq("batch_number", batchNumber);
  }

  await recordNewsletterEvent({
    tenant,
    campaign_id: campaign.id,
    event_type: "batch_failed",
    payload: {
      batch_number: batchNumber,
      error: message,
      user: userName,
    },
  });

  return updated;
}

export async function startAutomaticBatchCampaign({ tenant, campaign, userName }) {
  if (!campaign.test_sent_at) throw new Error("Stuur eerst een testmail");
  const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at).toISOString() : null;
  const isScheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  if (scheduledAt && !isScheduled) {
    throw new Error("De geplande verzendtijd ligt in het verleden. Kies een nieuwe toekomstige tijd of maak de verzendtijd leeg voor direct verzenden.");
  }

  const domainHealth = await checkNewsletterDomainHealth(tenant);
  if (!domainHealth.ok) throw new Error(domainHealth.reason || "Domeincheck is niet groen");

  const batchSize = normalizeBatchSize(campaign.batch_size) || DEFAULT_BATCH_SIZE;
  const recipientResult = await buildRecipientsForCampaign(
    tenant,
    campaign.segment_id,
    campaign.excluded_segment_ids,
    null,
    campaign.included_segment_ids
  );
  const recipients = recipientResult.recipients;
  if (!recipients.length) throw new Error("Geen ontvangers gevonden");
  assertUniqueNewsletterRecipients(recipients, "Nieuwsbrief automatische batchverzending");

  const snapshot = await syncRecipientSnapshot(tenant, campaign.id, recipients, { batchSize });
  const totalBatches = Math.ceil(snapshot.length / batchSize);
  await replaceCampaignBatches(tenant, campaign.id, totalBatches);

  const now = new Date().toISOString();
  const { data: prepared, error: prepareError } = await supabaseAdmin
    .from("newsletter_campaigns")
    .update({
      status: isScheduled ? "scheduled" : "syncing",
      batch_mode: "automatic",
      batch_size: batchSize,
      batch_total_count: totalBatches,
      batch_current_number: 0,
      batch_started_at: now,
      batch_next_run_at: isScheduled ? scheduledAt : null,
      batch_pause_reason: null,
      batch_alert_sent_at: null,
      recipient_count: 0,
      domain_check: domainHealth,
      domain_last_checked_at: now,
      approved_at: now,
      approved_by: userName,
      scheduled_at: scheduledAt,
      updated_at: now,
    })
    .eq("tenant", tenant)
    .eq("id", campaign.id)
    .select("*")
    .single();
  if (prepareError) throw new Error(prepareError.message);

  if (isScheduled) return prepared;

  try {
    return await sendCampaignBatch({ tenant, campaign: prepared, batchNumber: 1, userName });
  } catch (error) {
    await markAutomaticBatchFailed({ tenant, campaign: prepared, error, batchNumber: 1, userName });
    throw error;
  }
}

export async function calculateBatchHealth(tenant, campaign, batch) {
  const { data: events, error } = await supabaseAdmin
    .from("newsletter_events")
    .select("event_type, email, occurred_at, payload")
    .eq("tenant", tenant)
    .eq("campaign_id", campaign.id)
    .eq("resend_broadcast_id", batch.resend_broadcast_id);
  if (error) throw new Error(error.message);

  const recipientCount = Number(batch.recipient_count || 0);
  const counts = {
    delivered: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
    unsubscribed: 0,
  };
  const seen = {
    delivered: new Set(),
    bounced: new Set(),
    complained: new Set(),
    failed: new Set(),
    unsubscribed: new Set(),
  };
  let healthEventCount = 0;
  for (const event of events || []) {
    if (isHealthEvent(event)) healthEventCount += 1;
    const email = normalizeEmail(event.email) || `${event.event_type}:${event.occurred_at}`;
    for (const key of Object.keys(HEALTH_EVENT_TYPES)) {
      if (eventCountsForHealthBucket(key, event)) seen[key].add(email);
    }
  }
  for (const key of Object.keys(counts)) counts[key] = seen[key].size;
  const rates = eventHealthRates(counts, recipientCount);
  return {
    batch_number: batch.batch_number,
    recipient_count: recipientCount,
    event_count: healthEventCount,
    counts,
    rates,
    checked_at: new Date().toISOString(),
  };
}

async function sendCampaignPauseAlerts({ tenant, campaign, reason, health, domainHealth }) {
  if (campaign.batch_alert_sent_at) return;
  const crmUrl = `https://crm.48-7.nl/admin/nieuwsbrieven`;
  const subject = `Nieuwsbrief gepauzeerd: ${campaign.name}`;
  const text = [
    `Campagne "${campaign.name}" is gepauzeerd.`,
    `Reden: ${reason}`,
    health ? `Batch: ${health.batch_number}, ontvangers: ${health.recipient_count}` : null,
    health ? `Bounces: ${health.counts.bounced}, complaints: ${health.counts.complained}, unsubscribes: ${health.counts.unsubscribed}, failed: ${health.counts.failed}` : null,
    domainHealth && !domainHealth.ok ? `Domeincheck: ${domainHealth.reason}` : null,
    crmUrl,
  ].filter(Boolean).join("\n");

  try {
    const { resend, settings, from } = await getConfiguredResend(tenant);
    await resend.emails.send({
      from,
      to: [process.env.NEWSLETTER_ALERT_EMAIL || settings.reply_to || settings.from_email],
      replyTo: settings.reply_to,
      subject,
      text,
    });
  } catch (error) {
    console.warn("Kon nieuwsbrief-alertmail niet versturen", error.message);
  }

  if (tenant === "hiphot") {
    const message = `HipHot nieuwsbrief gepauzeerd: ${campaign.name}. ${reason}. Check CRM: ${crmUrl}`;
    try {
      if (process.env.HIPHOT_HUB_WHATSAPP_URL) {
        await fetch(process.env.HIPHOT_HUB_WHATSAPP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
      } else if (process.env.CALLMEBOT_API_KEY) {
        const url = new URL("https://api.callmebot.com/whatsapp.php");
        url.searchParams.set("phone", process.env.CALLMEBOT_PHONE || process.env.WHATSAPP_PHONE || "+31641917711");
        url.searchParams.set("text", message);
        url.searchParams.set("apikey", process.env.CALLMEBOT_API_KEY);
        await fetch(url);
      }
    } catch (error) {
      console.warn("Kon WhatsApp-alert niet versturen", error.message);
    }
  }

  await supabaseAdmin
    .from("newsletter_campaigns")
    .update({ batch_alert_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("tenant", tenant)
    .eq("id", campaign.id);
}

async function pauseBatchCampaign({ tenant, campaign, batch, reason, health, domainHealth }) {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("newsletter_campaign_batches")
    .update({
      status: "paused",
      health,
      pause_reason: reason,
      health_checked_at: now,
      updated_at: now,
    })
    .eq("tenant", tenant)
    .eq("campaign_id", campaign.id)
    .eq("batch_number", batch.batch_number);

  const { data: updated, error } = await supabaseAdmin
    .from("newsletter_campaigns")
    .update({
      status: "paused",
      batch_last_health: health || null,
      batch_pause_reason: reason,
      batch_next_run_at: null,
      domain_check: domainHealth || campaign.domain_check || null,
      domain_last_checked_at: new Date().toISOString(),
      updated_at: now,
    })
    .eq("tenant", tenant)
    .eq("id", campaign.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await sendCampaignPauseAlerts({ tenant, campaign: updated, reason, health, domainHealth });
  return updated;
}

export async function processAutomaticBatchCampaign({ tenant, campaign, userName = "CRM cron" }) {
  if (campaign.status === "scheduled" && campaign.batch_mode === "automatic") {
    if (campaign.batch_next_run_at && new Date(campaign.batch_next_run_at).getTime() > Date.now()) return campaign;

    const now = new Date().toISOString();
    const { data: prepared, error: prepareError } = await supabaseAdmin
      .from("newsletter_campaigns")
      .update({ status: "syncing", batch_next_run_at: null, updated_at: now })
      .eq("tenant", tenant)
      .eq("id", campaign.id)
      .select("*")
      .single();
    if (prepareError) throw new Error(prepareError.message);

    try {
      return await sendCampaignBatch({ tenant, campaign: prepared, batchNumber: 1, userName });
    } catch (error) {
      await markAutomaticBatchFailed({ tenant, campaign: prepared, error, batchNumber: 1, userName });
      throw error;
    }
  }

  if (campaign.status !== "batch_waiting") return campaign;
  if (campaign.batch_next_run_at && new Date(campaign.batch_next_run_at).getTime() > Date.now()) return campaign;

  const { data: batch, error: batchError } = await supabaseAdmin
    .from("newsletter_campaign_batches")
    .select("*")
    .eq("tenant", tenant)
    .eq("campaign_id", campaign.id)
    .eq("batch_number", campaign.batch_current_number)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) throw new Error("Laatste batch-run ontbreekt");

  const [health, domainHealth] = await Promise.all([
    calculateBatchHealth(tenant, campaign, batch),
    checkNewsletterDomainHealth(tenant),
  ]);
  const pauseReason = evaluateBatchHealth(campaign, health, domainHealth);
  if (pauseReason) {
    return pauseBatchCampaign({ tenant, campaign, batch, reason: pauseReason, health, domainHealth });
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("newsletter_campaign_batches")
    .update({
      status: "healthy",
      health,
      health_checked_at: now,
      updated_at: now,
    })
    .eq("tenant", tenant)
    .eq("campaign_id", campaign.id)
    .eq("batch_number", batch.batch_number);

  await supabaseAdmin
    .from("newsletter_campaigns")
    .update({
      batch_last_health: health,
      domain_check: domainHealth,
      domain_last_checked_at: now,
      updated_at: now,
    })
    .eq("tenant", tenant)
    .eq("id", campaign.id);

  const nextBatchNumber = Number(campaign.batch_current_number || 0) + 1;
  if (nextBatchNumber > Number(campaign.batch_total_count || 0)) {
    const { data: completed, error } = await supabaseAdmin
      .from("newsletter_campaigns")
      .update({ status: "sent", sent_at: now, batch_next_run_at: null, updated_at: now })
      .eq("tenant", tenant)
      .eq("id", campaign.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return completed;
  }

  const refreshedCampaign = {
    ...campaign,
    batch_last_health: health,
    domain_check: domainHealth,
  };
  try {
    return await sendCampaignBatch({ tenant, campaign: refreshedCampaign, batchNumber: nextBatchNumber, userName });
  } catch (error) {
    await markAutomaticBatchFailed({ tenant, campaign: refreshedCampaign, error, batchNumber: nextBatchNumber, userName });
    throw error;
  }
}

export async function syncAndSendCampaign({ tenant, campaign, userName }) {
  const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at).toISOString() : null;
  const isScheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  if (scheduledAt && !isScheduled) {
    throw new Error("De geplande verzendtijd ligt in het verleden. Kies een nieuwe toekomstige tijd of maak de verzendtijd leeg voor direct verzenden.");
  }

  if (campaign.batch_mode === "automatic") {
    return startAutomaticBatchCampaign({
      tenant,
      campaign: { ...campaign, scheduled_at: scheduledAt },
      userName,
    });
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
      campaign.recipient_limit,
      campaign.included_segment_ids
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
