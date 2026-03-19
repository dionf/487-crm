import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { supabase } from "@/lib/supabase";

// Protect endpoint: only callable via cron secret or internal
const CRON_SECRET = process.env.CRON_SECRET;

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for IMAP polling

export async function GET(request) {
  try {
  // Auth check
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const imapHost = process.env.LEAD_INBOX_HOST || "mail.48-7.nl";
  const imapUser = process.env.LEAD_INBOX_USER || "leads@48-7.nl";
  const imapPass = process.env.LEAD_INBOX_PASSWORD;
  const imapPort = parseInt(process.env.LEAD_INBOX_PORT || "993");
  console.log(`[poll-inbox] Starting IMAP poll... host=${imapHost} user=${imapUser} port=${imapPort} pass=${imapPass ? `SET(${imapPass.length}chars)` : "MISSING"}`);

  const results = [];
  let client;

  try {
    // Connect to IMAP
    client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: true,
      auth: {
        user: imapUser,
        pass: imapPass,
      },
      logger: {
        debug: (info) => console.log("[IMAP debug]", info?.message || info),
        info: (info) => console.log("[IMAP info]", info?.message || info),
        warn: (info) => console.warn("[IMAP warn]", info?.message || info),
        error: (info) => console.error("[IMAP error]", info?.message || info),
      },
      tls: { rejectUnauthorized: false },
      connectTimeout: 30000,
      greetingTimeout: 15000,
    });

    console.log("[poll-inbox] Connecting to IMAP...");
    await client.connect();
    console.log("[poll-inbox] Connected!");

    // Open INBOX
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Search for unseen messages
      const messages = [];
      for await (const msg of client.fetch(
        { seen: false },
        {
          uid: true,
          envelope: true,
          source: true,
        }
      )) {
        messages.push(msg);
      }

      if (messages.length === 0) {
        return Response.json({
          success: true,
          message: "Geen nieuwe emails",
          processed: 0,
        });
      }

      // Process each email
      for (const msg of messages) {
        const logEntry = {
          email_subject: msg.envelope?.subject || "(geen onderwerp)",
          email_from: msg.envelope?.from?.[0]?.address || "unknown",
          message_id: msg.envelope?.messageId || null,
          status: "pending",
        };

        try {
          // Check deduplication
          if (logEntry.message_id) {
            const { data: existing } = await supabase
              .from("leads")
              .select("id")
              .eq("source_email_id", logEntry.message_id)
              .maybeSingle();

            if (existing) {
              logEntry.status = "skipped_duplicate";
              await insertLog(logEntry);
              // Mark as read anyway
              await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
              results.push({ ...logEntry });
              continue;
            }
          }

          // Parse email content
          const parsed = await simpleParser(msg.source);
          const emailBody =
            parsed.text ||
            stripHtml(parsed.html || "") ||
            "(geen inhoud)";
          const fromEmail = parsed.from?.value?.[0]?.address || logEntry.email_from;
          const fromName = parsed.from?.value?.[0]?.name || "";

          // Extract lead data with Claude
          const leadData = await extractLeadWithClaude(
            emailBody,
            logEntry.email_subject,
            fromEmail,
            fromName
          );

          // Insert lead
          const { data: lead, error: leadError } = await supabase
            .from("leads")
            .insert({
              company_name: leadData.company_name || "Onbekend — handmatig beoordelen",
              contact_person: leadData.contact_person || fromName || "Onbekend",
              email: leadData.email || fromEmail,
              phone: leadData.phone || null,
              service_type: leadData.service_type || null,
              estimated_value: leadData.estimated_value || null,
              source: leadData.source || "email",
              website_url: extractWebsiteFromEmail(leadData.email || fromEmail),
              source_email_id: logEntry.message_id,
              status: "nieuw",
            })
            .select()
            .single();

          if (leadError) throw new Error(`Lead insert failed: ${leadError.message}`);

          // Insert original email as note
          await supabase.from("notes").insert({
            lead_id: lead.id,
            content: `Van: ${fromName} <${fromEmail}>\nOnderwerp: ${logEntry.email_subject}\n\n${emailBody}`,
            note_type: "email",
            created_by: "Inbox",
          });

          // Insert AI summary as intern note
          if (leadData.summary) {
            await supabase.from("notes").insert({
              lead_id: lead.id,
              content: `AI Samenvatting: ${leadData.summary}`,
              note_type: "intern",
              created_by: "AI",
            });
          }

          // Insert follow-up todo
          await supabase.from("notes").insert({
            lead_id: lead.id,
            content: "Lead beoordelen en opvolgen",
            note_type: "todo",
            is_completed: false,
            created_by: "Inbox",
            due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // morgen
          });

          // Log activity
          await supabase.from("activities").insert({
            lead_id: lead.id,
            activity_type: "lead_created",
            description: `Lead aangemaakt via email intake: ${leadData.company_name || "Onbekend"}`,
            created_by: "Inbox",
          });

          // Mark email as read
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });

          logEntry.status = "success";
          logEntry.lead_id = lead.id;
          await insertLog(logEntry);
          results.push({ ...logEntry, lead_id: lead.id });
        } catch (emailError) {
          // Fallback: create lead anyway with raw email content
          logEntry.status = "error";
          logEntry.error_message = emailError.message;

          try {
            const parsed = await simpleParser(msg.source).catch(() => null);
            const emailBody = parsed?.text || parsed?.html || "(kon email niet parsen)";
            const fromEmail = parsed?.from?.value?.[0]?.address || logEntry.email_from;

            const { data: fallbackLead } = await supabase
              .from("leads")
              .insert({
                company_name: "Onbekend — handmatig beoordelen",
                contact_person: parsed?.from?.value?.[0]?.name || "Onbekend",
                email: fromEmail,
                source: "email",
                source_email_id: logEntry.message_id,
                status: "nieuw",
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

            // Mark as read even on error
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
      email_subject: null,
      email_from: null,
      message_id: null,
      status: "connection_error",
      error_message: connError.message,
    });

    return Response.json(
      { error: "IMAP verbinding mislukt", detail: connError.message, code: connError.code, responseCode: connError.responseCode },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    processed: results.length,
    results,
  });

  } catch (topError) {
    console.error("[poll-inbox] Top-level error:", topError);
    return Response.json(
      { error: "Onverwachte fout", detail: topError.message, stack: topError.stack },
      { status: 500 }
    );
  }
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

async function extractLeadWithClaude(emailBody, subject, fromEmail, fromName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { summary: null };
  }

  const prompt = `Je bent een lead intake assistent voor 48-7 AI Professionals. Analyseer de onderstaande email en extraheer de volgende informatie als JSON.

Velden:
- company_name: bedrijfsnaam (zoek naar bedrijfsnaam in handtekening, emaildomein of inhoud)
- contact_person: naam van de afzender
- email: emailadres (gebruik het from-adres als fallback)
- phone: telefoonnummer als gevonden (inclusief mobiel)
- service_type: een van: "cowork_setup", "training", "maatwerk", "support_contract", "partner" — kies de best passende, of null als onduidelijk
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

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { summary: null };
  } catch {
    return { summary: null };
  }
}
