import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { supabase } from "@/lib/supabase";
import { getAuthCookie, verifyToken } from "@/lib/auth";

// Protect endpoint: callable via cron secret OR by an authenticated user (manual trigger)
const CRON_SECRET = process.env.CRON_SECRET;

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for IMAP polling

// ---- Mailbox configuration ----
// Each tenant has its own IMAP mailbox. Missing password → mailbox skipped.
function getMailboxes() {
  return [
    {
      tenant: "48-7",
      companyName: "48-7 AI Professionals",
      host: process.env.LEAD_INBOX_HOST || "mail.48-7.nl",
      user: process.env.LEAD_INBOX_USER || "leads@48-7.nl",
      pass: process.env.LEAD_INBOX_PASSWORD,
      port: parseInt(process.env.LEAD_INBOX_PORT || "993"),
      internalDomains: ["48-7.nl", "48-7.ai"],
      defaultStatus: "nieuw",
      serviceTypes: ["cowork_setup", "training", "maatwerk", "support_contract", "partner"],
    },
    {
      tenant: "hiphot",
      companyName: "HipHot B.V.",
      host: process.env.LEAD_INBOX_HIPHOT_HOST || "mail.hiphot.nl",
      user: process.env.LEAD_INBOX_HIPHOT_USER || "leads@hiphot.nl",
      pass: process.env.LEAD_INBOX_HIPHOT_PASSWORD,
      port: parseInt(process.env.LEAD_INBOX_HIPHOT_PORT || "993"),
      internalDomains: ["hiphot.nl", "hiphot.com", "hiphot.eu"],
      defaultStatus: "nieuwe_aanvraag",
      serviceTypes: [],
    },
  ].filter((m) => !!m.pass); // skip unconfigured mailboxes
}

export async function GET(request) {
  try {
    // Auth check: accept cron bearer OR an authenticated user cookie
    const authHeader = request.headers.get("authorization");
    const isCronCall = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
    let callerTenant = null;
    if (!isCronCall) {
      const token = getAuthCookie(request);
      const session = token ? await verifyToken(token) : null;
      if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      callerTenant = session.tenant;
    }

    // Manual trigger polls only the caller's tenant; cron polls all
    const mailboxes = getMailboxes().filter(
      (m) => isCronCall || m.tenant === callerTenant
    );
    if (mailboxes.length === 0) {
      return Response.json(
        { error: isCronCall ? "Geen inbox geconfigureerd — zet minstens één LEAD_INBOX_PASSWORD" : "Geen mailbox geconfigureerd voor deze tenant" },
        { status: isCronCall ? 500 : 400 }
      );
    }

    const perMailboxResults = [];
    for (const mailbox of mailboxes) {
      const result = await pollMailbox(mailbox);
      perMailboxResults.push({ tenant: mailbox.tenant, ...result });
    }

    const totalProcessed = perMailboxResults.reduce((sum, r) => sum + (r.processed || 0), 0);

    return Response.json({
      success: true,
      processed: totalProcessed,
      mailboxes: perMailboxResults,
    });
  } catch (topError) {
    console.error("[poll-inbox] Top-level error:", topError);
    return Response.json(
      { error: "Onverwachte fout", detail: topError.message, stack: topError.stack },
      { status: 500 }
    );
  }
}

async function pollMailbox(mailbox) {
  console.log(
    `[poll-inbox:${mailbox.tenant}] Starting IMAP poll... host=${mailbox.host} user=${mailbox.user} port=${mailbox.port}`
  );

  const results = [];
  const imapLogs = [];
  let client;

  try {
    client = new ImapFlow({
      host: mailbox.host,
      port: mailbox.port,
      secure: true,
      auth: { user: mailbox.user, pass: mailbox.pass },
      logger: {
        debug: (info) => imapLogs.push({ level: "debug", msg: JSON.stringify(info).substring(0, 200) }),
        info: (info) => imapLogs.push({ level: "info", msg: JSON.stringify(info).substring(0, 200) }),
        warn: (info) => imapLogs.push({ level: "warn", msg: JSON.stringify(info).substring(0, 200) }),
        error: (info) => imapLogs.push({ level: "error", msg: JSON.stringify(info).substring(0, 200) }),
      },
      tls: { rejectUnauthorized: false },
      connectTimeout: 30000,
      greetingTimeout: 15000,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const messages = [];
      for await (const msg of client.fetch(
        { seen: false },
        { uid: true, envelope: true, source: true }
      )) {
        messages.push(msg);
      }

      if (messages.length === 0) {
        return { success: true, message: "Geen nieuwe emails", processed: 0, results: [] };
      }

      for (const msg of messages) {
        const logEntry = {
          tenant: mailbox.tenant,
          email_subject: msg.envelope?.subject || "(geen onderwerp)",
          email_from: msg.envelope?.from?.[0]?.address || "unknown",
          message_id: msg.envelope?.messageId || null,
          status: "pending",
        };

        try {
          // Dedup
          if (logEntry.message_id) {
            const { data: existing } = await supabase
              .from("leads")
              .select("id")
              .eq("source_email_id", logEntry.message_id)
              .eq("tenant", mailbox.tenant)
              .maybeSingle();

            if (existing) {
              logEntry.status = "skipped_duplicate";
              await insertLog(logEntry);
              await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
              results.push({ ...logEntry });
              continue;
            }
          }

          const parsed = await simpleParser(msg.source);
          const fromEmail = parsed.from?.value?.[0]?.address || logEntry.email_from;
          const fromName = parsed.from?.value?.[0]?.name || "";

          const fullHtmlBody = parsed.html ? stripHtml(parsed.html) : null;
          const textBody = parsed.text || "";
          const emailBody =
            fullHtmlBody && fullHtmlBody.length > textBody.length
              ? fullHtmlBody
              : textBody || "(geen inhoud)";

          // Match against existing lead within SAME tenant
          const allEmails = extractAllEmails(
            emailBody,
            fromEmail,
            parsed.to?.value,
            parsed.cc?.value,
            mailbox.internalDomains
          );
          let existingLead = null;

          for (const checkEmail of allEmails) {
            const { data } = await supabase
              .from("leads")
              .select("id, company_name, contact_person, email")
              .ilike("email", checkEmail)
              .eq("tenant", mailbox.tenant)
              .limit(1)
              .maybeSingle();
            if (data) {
              existingLead = data;
              break;
            }
          }

          if (existingLead) {
            await supabase.from("notes").insert({
              lead_id: existingLead.id,
              content: `Van: ${fromName} <${fromEmail}>\nOnderwerp: ${logEntry.email_subject}\n\n${emailBody}`,
              note_type: "email",
              created_by: "Inbox",
            });

            await supabase.from("activities").insert({
              lead_id: existingLead.id,
              activity_type: "email_received",
              description: `Email ontvangen: ${logEntry.email_subject}`,
              created_by: "Inbox",
            });

            await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });

            logEntry.status = "matched_existing";
            logEntry.lead_id = existingLead.id;
            await insertLog(logEntry);
            results.push({
              ...logEntry,
              company_name: existingLead.company_name,
              contact_person: existingLead.contact_person,
            });
            continue;
          }

          // Extract via Claude — tenant-aware prompt
          const leadData = await extractLeadWithClaude(
            emailBody,
            logEntry.email_subject,
            fromEmail,
            fromName,
            mailbox
          );

          const fullName = leadData.contact_person || fromName || "Onbekend";
          const nameParts = fullName.split(" ");
          const inboxFirstName = nameParts[0] || "";
          const inboxLastName = nameParts.slice(1).join(" ") || "";

          const { data: lead, error: leadError } = await supabase
            .from("leads")
            .insert({
              tenant: mailbox.tenant,
              company_name: leadData.company_name || "Onbekend — handmatig beoordelen",
              contact_person: fullName,
              contact_first_name: inboxFirstName,
              contact_last_name: inboxLastName,
              email: leadData.email || fromEmail,
              phone: leadData.phone || null,
              service_type: leadData.service_type || null,
              estimated_value: leadData.estimated_value || null,
              source: leadData.source || "email",
              website_url: extractWebsiteFromEmail(leadData.email || fromEmail),
              source_email_id: logEntry.message_id,
              status: mailbox.defaultStatus,
            })
            .select()
            .single();

          if (leadError) throw new Error(`Lead insert failed: ${leadError.message}`);

          await supabase.from("notes").insert({
            lead_id: lead.id,
            content: `Van: ${fromName} <${fromEmail}>\nOnderwerp: ${logEntry.email_subject}\n\n${emailBody}`,
            note_type: "email",
            created_by: "Inbox",
          });

          if (leadData.summary) {
            await supabase.from("notes").insert({
              lead_id: lead.id,
              content: `AI Samenvatting: ${leadData.summary}`,
              note_type: "intern",
              created_by: "AI",
            });
          }

          await supabase.from("notes").insert({
            lead_id: lead.id,
            content: "Lead beoordelen en opvolgen",
            note_type: "todo",
            is_completed: false,
            created_by: "Inbox",
            due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });

          await supabase.from("activities").insert({
            lead_id: lead.id,
            activity_type: "lead_created",
            description: `Lead aangemaakt via email intake: ${leadData.company_name || "Onbekend"}`,
            created_by: "Inbox",
          });

          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });

          logEntry.status = "success";
          logEntry.lead_id = lead.id;
          await insertLog(logEntry);
          results.push({
            ...logEntry,
            company_name: lead.company_name,
            contact_person: fullName,
          });
        } catch (emailError) {
          logEntry.status = "error";
          logEntry.error_message = emailError.message;

          try {
            const parsed = await simpleParser(msg.source).catch(() => null);
            const emailBody = parsed?.text || parsed?.html || "(kon email niet parsen)";
            const fromEmail = parsed?.from?.value?.[0]?.address || logEntry.email_from;

            const { data: fallbackLead } = await supabase
              .from("leads")
              .insert({
                tenant: mailbox.tenant,
                company_name: "Onbekend — handmatig beoordelen",
                contact_person: parsed?.from?.value?.[0]?.name || "Onbekend",
                email: fromEmail,
                source: "email",
                source_email_id: logEntry.message_id,
                status: mailbox.defaultStatus,
              })
              .select()
              .single();

            if (fallbackLead) {
              await supabase.from("notes").insert({
                lead_id: fallbackLead.id,
                content: `[FOUT BIJ VERWERKING]\n\nOriginele email:\nVan: ${fromEmail}\nOnderwerp: ${logEntry.email_subject}\n\n${emailBody}`,
                note_type: "email",
                created_by: "Inbox",
              });

              await supabase.from("notes").insert({
                lead_id: fallbackLead.id,
                content: "Lead beoordelen en opvolgen — email kon niet automatisch verwerkt worden",
                note_type: "todo",
                is_completed: false,
                created_by: "Inbox",
              });

              logEntry.lead_id = fallbackLead.id;
              logEntry.status = "fallback";
            }

            await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
          } catch {
            // Total failure — don't mark as read so it gets retried
          }

          await insertLog(logEntry);
          results.push(logEntry);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (connError) {
    await insertLog({
      tenant: mailbox.tenant,
      email_subject: null,
      email_from: null,
      message_id: null,
      status: "connection_error",
      error_message: connError.message,
    });

    return {
      error: "IMAP verbinding mislukt",
      detail: connError.message,
      code: connError.code,
      responseCode: connError.responseCode,
      imapLogs: imapLogs.slice(-10),
      processed: 0,
    };
  }

  return { success: true, processed: results.length, results };
}

// ---- Helper functions ----

async function insertLog(entry) {
  try {
    await supabase.from("lead_inbox_log").insert(entry);
  } catch {
    // Silently fail — logging should never break the main flow
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract all non-internal email addresses from the thread for lead matching
function extractAllEmails(body, fromEmail, toAddresses, ccAddresses, internalDomains = []) {
  const emails = new Set();

  if (fromEmail) emails.add(fromEmail.toLowerCase());

  [toAddresses, ccAddresses].forEach((list) => {
    (list || []).forEach((addr) => {
      if (addr.address) emails.add(addr.address.toLowerCase());
    });
  });

  const bodyEmails = body.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
  bodyEmails.forEach((e) => emails.add(e.toLowerCase()));

  const filtered = [...emails].filter((e) => {
    const domain = e.split("@")[1];
    return !internalDomains.includes(domain) && !FREE_EMAIL_DOMAINS.includes(domain);
  });

  return filtered;
}

const FREE_EMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl",
  "outlook.com", "outlook.nl", "live.com", "live.nl",
  "yahoo.com", "yahoo.nl", "icloud.com", "me.com", "mac.com",
  "ziggo.nl", "kpnmail.nl", "xs4all.nl", "protonmail.com", "proton.me",
];

function extractWebsiteFromEmail(email) {
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE_EMAIL_DOMAINS.includes(domain)) return null;
  return `https://${domain}`;
}

async function extractLeadWithClaude(emailBody, subject, fromEmail, fromName, mailbox) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { summary: null };
  }

  const serviceLine = mailbox.serviceTypes?.length
    ? `- service_type: een van: ${mailbox.serviceTypes.map((s) => `"${s}"`).join(", ")} — kies de best passende, of null als onduidelijk`
    : `- service_type: type dienst/product dat de prospect zoekt, of null als onduidelijk`;

  const prompt = `Je bent een lead intake assistent voor ${mailbox.companyName}. Analyseer de onderstaande email en extraheer de volgende informatie als JSON.

Velden:
- company_name: bedrijfsnaam (zoek naar bedrijfsnaam in handtekening, emaildomein of inhoud)
- contact_person: naam van de afzender
- email: emailadres (gebruik het from-adres als fallback)
- phone: telefoonnummer als gevonden (inclusief mobiel)
${serviceLine}
- source: hoe is deze lead binnengekomen? bijv. "website", "referral", "linkedin", "email" — standaard "email"
- summary: korte samenvatting (max 2 zinnen) van de vraag/behoefte
- estimated_value: geschatte waarde in EUR als je een inschatting kunt maken, anders null

Afzender: ${fromName} <${fromEmail}>
Onderwerp: ${subject}

Email body:
${emailBody.substring(0, 3000)}

Antwoord ALLEEN met valid JSON, geen tekst eromheen.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { summary: null };
  } catch {
    return { summary: null };
  }
}
