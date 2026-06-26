import { supabase } from "@/lib/supabase";
import { Resend } from "resend";
import { wrapEmailHtml } from "@/lib/email-template";
import { getAuthCookie, verifyToken } from "@/lib/auth";

// Monitor-modus: detecteert quotes die rijp zijn voor een vervalherinnering,
// stuurt een dagelijkse digest-mail naar het HipHot-team. Verstuurt NIETS naar
// klanten — fase 1 om de detectie te valideren. Wanneer de medewerker tevreden
// is, vervangen we de digest-loop door een echte resend.emails.send naar de
// klant met de gebruikelijke template.

const CRON_SECRET = process.env.CRON_SECRET;
const REMINDER_THRESHOLD_DAYS = 10;
const NOTIFY_EMAIL = "hallo@hiphot.nl";
const FROM = "HipHot CRM <hallo@hiphot.nl>";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function getResendKey() {
  return process.env.RESEND_API_KEY_HIPHOT || process.env.RESEND_API_KEY;
}

function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function formatDateNL(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function GET(request) {
  // Auth: cron bearer OF ingelogde HipHot-user (handmatige trigger)
  const authHeader = request.headers.get("authorization");
  const isCronCall = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  if (!isCronCall) {
    const token = getAuthCookie(request);
    const session = token ? await verifyToken(token) : null;
    if (!session || session.tenant !== "hiphot") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const today = new Date();
  const cutoff = new Date(today.getTime() - REMINDER_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const todayIso = today.toISOString().split("T")[0];

  // Detecteren: status = 'verstuurd', sent_at >= 10d geleden,
  // geen accept/afwijzing, niet verlopen.
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select(
      "id, quote_number, sent_at, valid_until, amount_excl_vat, public_hash, lead_id, leads(id, company_name, contact_first_name, contact_last_name, contact_person, email, tenant)"
    )
    .eq("tenant", "hiphot")
    .eq("status", "verstuurd")
    .is("accepted_at", null)
    .lte("sent_at", cutoffIso)
    .gte("valid_until", todayIso)
    .order("sent_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const candidates = (quotes || []).filter((q) => q.leads?.tenant === "hiphot");

  if (candidates.length === 0) {
    return Response.json({
      monitor_mode: true,
      candidates: 0,
      message: "Geen offertes rijp voor herinnering vandaag.",
    });
  }

  // Digest-mail bouwen
  const rows = candidates
    .map((q) => {
      const lead = q.leads || {};
      const naam =
        [lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ") ||
        lead.contact_person ||
        "—";
      const daysSent = daysBetween(q.sent_at, today);
      const daysLeft = daysBetween(today, q.valid_until);
      const amount = q.amount_excl_vat
        ? new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(q.amount_excl_vat)
        : "—";
      const leadUrl = `https://crm.48-7.nl/leads/${q.lead_id}`;
      const quoteUrl = q.public_hash ? `https://crm.48-7.nl/offerte/${q.public_hash}` : null;
      return `
        <tr>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; font-weight:600;">${q.quote_number}</td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">
            <a href="${leadUrl}" style="color:#1a1a1a; text-decoration:none;">${lead.company_name || "—"}</a>
            <div style="font-size:12px; color:#6b7280;">${naam}${lead.email ? ` · ${lead.email}` : ""}</div>
          </td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:right;">${amount}</td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:center; color:${daysSent >= 14 ? "#b45309" : "#374151"};">
            ${daysSent}d
          </td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:center; color:${daysLeft <= 7 ? "#dc2626" : "#374151"};">
            ${daysLeft}d
          </td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; white-space:nowrap;">
            <a href="${leadUrl}" style="display:inline-block; padding:6px 12px; background:#FFD500; color:#0D0D0F; font-weight:600; border-radius:999px; text-decoration:none; font-size:12px;">Open lead</a>
            ${quoteUrl ? `<a href="${quoteUrl}" style="display:inline-block; padding:6px 12px; background:#f3f4f6; color:#374151; border-radius:999px; text-decoration:none; font-size:12px; margin-left:4px;">Offerte</a>` : ""}
          </td>
        </tr>`;
    })
    .join("");

  const subject = `${candidates.length} offerte${candidates.length === 1 ? "" : "s"} rijp voor follow-up`;
  const bodyHtml = `
    <h2 style="margin:0 0 8px; font-size:18px; color:#1a1a1a;">Offertes ≥${REMINDER_THRESHOLD_DAYS} dagen verstuurd zonder reactie</h2>
    <p style="margin:0 0 20px; font-size:14px; color:#6b7280;">
      Klanten kunnen een duwtje gebruiken. Open de lead om handmatig een herinnering te sturen, of laat ze gaan tot ze verlopen.
    </p>
    <table style="width:100%; border-collapse:collapse; font-size:13px; color:#1a1a1a;">
      <thead>
        <tr style="background:#f9fafb; text-align:left;">
          <th style="padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">Offerte</th>
          <th style="padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">Klant</th>
          <th style="padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; text-align:right;">Bedrag</th>
          <th style="padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; text-align:center;">Verstuurd</th>
          <th style="padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; text-align:center;">Verloopt</th>
          <th style="padding:8px;"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:24px 0 0; font-size:12px; color:#9ca3af; line-height:1.6;">
      🔍 Monitor-modus: er gaat <strong>nog geen mail naar de klant</strong>. Wanneer je vertrouwt op deze detectie, draaien we de cron om naar auto-versturen.
    </p>`;

  const resend = new Resend(getResendKey());
  let mailError = null;
  try {
    await resend.emails.send({
      from: FROM,
      to: [NOTIFY_EMAIL],
      subject,
      html: wrapEmailHtml(bodyHtml, { tenant: "hiphot" }),
    });
  } catch (err) {
    mailError = err.message;
  }

  return Response.json({
    monitor_mode: true,
    candidates: candidates.length,
    sent_to: NOTIFY_EMAIL,
    mail_error: mailError,
    quote_numbers: candidates.map((q) => q.quote_number),
  });
}
