import { supabase } from "@/lib/supabase";
import { Resend } from "resend";
import { wrapEmailHtml } from "@/lib/email-template";

export async function POST(request, { params }) {
  const hash = (await params).hash;

  // Find quote by hash (include lead + tenant info)
  const { data: quote, error: findError } = await supabase
    .from("quotes")
    .select("id, lead_id, quote_number, status, valid_until, accepted_at, amount_excl_vat, tenant, leads(id, company_name, contact_person, email, tenant)")
    .eq("public_hash", hash)
    .maybeSingle();

  if (!quote) {
    return Response.json(
      { error: "Offerte niet gevonden" },
      { status: 404 }
    );
  }

  // Check if already accepted
  if (quote.accepted_at) {
    return Response.json(
      { error: "Deze offerte is al geaccepteerd", accepted_at: quote.accepted_at },
      { status: 400 }
    );
  }

  // Check validity
  if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
    return Response.json(
      { error: "Deze offerte is verlopen" },
      { status: 410 }
    );
  }

  // Check status
  if (quote.status === "afgewezen") {
    return Response.json(
      { error: "Deze offerte is afgewezen" },
      { status: 400 }
    );
  }

  // Accept the quote
  const { error: updateError } = await supabase
    .from("quotes")
    .update({
      accepted_at: new Date().toISOString(),
      status: "geaccepteerd",
    })
    .eq("id", quote.id);

  if (updateError) {
    return Response.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  // Auto-update lead status to "gewonnen" / "offerte_gewonnen"
  if (quote.lead_id) {
    const tenant = quote.tenant || quote.leads?.tenant;
    const wonStatus = tenant === "hiphot" ? "offerte_gewonnen" : "gewonnen";

    await supabase
      .from("leads")
      .update({
        status: wonStatus,
        won_at: new Date().toISOString(),
      })
      .eq("id", quote.lead_id);

    // Log activity
    await supabase.from("activities").insert({
      lead_id: quote.lead_id,
      activity_type: "quote_accepted",
      description: `Offerte ${quote.quote_number} geaccepteerd door klant via publieke link`,
      created_by: "Klant",
      tenant,
    });

    // Send notification email to team
    await sendAcceptanceNotification(quote, tenant);
  }

  return Response.json({
    success: true,
    message: "Offerte geaccepteerd",
    quote_number: quote.quote_number,
  });
}

function getResendKey(tenant) {
  if (tenant === "hiphot" && process.env.RESEND_API_KEY_HIPHOT) {
    return process.env.RESEND_API_KEY_HIPHOT;
  }
  if (tenant === "48-7" && process.env.RESEND_API_KEY_487) {
    return process.env.RESEND_API_KEY_487;
  }
  return process.env.RESEND_API_KEY;
}

async function sendAcceptanceNotification(quote, tenant) {
  try {
    const apiKey = getResendKey(tenant);
    if (!apiKey) return;

    const resend = new Resend(apiKey);

    // Determine notification recipient based on tenant
    const notifyEmail = tenant === "hiphot" ? "hallo@hiphot.nl" : "dion@48-7.nl";
    const fromEmail = tenant === "hiphot" ? "hallo@hiphot.nl" : "dion@48-7.nl";
    const fromName = tenant === "hiphot" ? "HipHot CRM" : "48-7 CRM";

    const companyName = quote.leads?.company_name || "Onbekend";
    const contactPerson = quote.leads?.contact_person || "";
    const amount = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(quote.amount_excl_vat || 0);
    const crmUrl = `https://crm.48-7.nl/leads/${quote.lead_id}`;

    const notificationBody = `
      <div style="background: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 24px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px; color: #166534; font-size: 18px;">Offerte geaccepteerd!</h2>
        <p style="margin: 0; color: #15803d; font-size: 14px;">
          ${contactPerson ? `${contactPerson} van ` : ""}${companyName} heeft offerte <strong>${quote.quote_number}</strong> zojuist geaccepteerd.
        </p>
      </div>
      <table style="width: 100%; font-size: 14px; color: #374151;">
        <tr>
          <td style="padding: 6px 0; color: #6b7280;">Bedrijf</td>
          <td style="padding: 6px 0; font-weight: 600;">${companyName}</td>
        </tr>
        ${contactPerson ? `<tr>
          <td style="padding: 6px 0; color: #6b7280;">Contact</td>
          <td style="padding: 6px 0;">${contactPerson}</td>
        </tr>` : ""}
        <tr>
          <td style="padding: 6px 0; color: #6b7280;">Offerte</td>
          <td style="padding: 6px 0;">${quote.quote_number}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280;">Bedrag</td>
          <td style="padding: 6px 0; font-weight: 600;">${amount} excl. BTW</td>
        </tr>
      </table>
      <div style="margin-top: 20px;">
        <a href="${crmUrl}" style="display: inline-block; background: ${tenant === "hiphot" ? "#FFD500" : "#FAB868"}; color: #0D0D0F; font-weight: 600; padding: 10px 24px; border-radius: 999px; text-decoration: none; font-size: 14px;">
          Bekijk in CRM
        </a>
      </div>
      <p style="margin-top: 16px; font-size: 12px; color: #9ca3af;">
        De lead is automatisch naar "Gewonnen" verplaatst.
      </p>
    `;

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [notifyEmail],
      subject: `Offerte ${quote.quote_number} geaccepteerd — ${companyName}`,
      html: wrapEmailHtml(notificationBody, { tenant }),
    });
  } catch (err) {
    // Don't fail the acceptance if notification fails
    console.error("Failed to send acceptance notification:", err);
  }
}
