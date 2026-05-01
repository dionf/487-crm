import { supabase } from "@/lib/supabase";
import { Resend } from "resend";
import { wrapEmailHtml } from "@/lib/email-template";

// Velden die de klant via het accept-formulier mag aanvullen.
// Lege strings filteren we eruit zodat bestaande lead-data niet wordt overschreven met "".
const BILLING_FIELDS = [
  "billing_street",
  "billing_house_number",
  "billing_postal_code",
  "billing_city",
  "billing_country",
  "billing_email",
];
const DELIVERY_FIELDS = [
  "delivery_street",
  "delivery_house_number",
  "delivery_postal_code",
  "delivery_city",
  "delivery_country",
];

function cleanString(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function POST(request, { params }) {
  const hash = (await params).hash;

  // Body is optional — als de klant via de oude (body-loze) flow komt, behandelen we 'm als leeg.
  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

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
  let customerInput = null;
  if (quote.lead_id) {
    const tenant = quote.tenant || quote.leads?.tenant;
    const wonStatus = tenant === "hiphot" ? "offerte_gewonnen" : "gewonnen";

    // Bouw lead-update op met klant-input. Lege velden niet meesturen.
    const leadUpdate = {
      status: wonStatus,
      won_at: new Date().toISOString(),
    };

    for (const f of BILLING_FIELDS) {
      const v = cleanString(body[f]);
      if (v !== null) leadUpdate[f] = v;
    }

    const customerReference = cleanString(body.customer_reference);
    if (customerReference !== null) leadUpdate.customer_reference = customerReference;

    // 48-7 heeft geen leveradres-concept: forceer same_as_billing en negeer delivery-velden.
    if (tenant === "48-7") {
      leadUpdate.delivery_same_as_billing = true;
    } else {
      const sameAsBilling = body.delivery_same_as_billing;
      if (sameAsBilling === true || sameAsBilling === false) {
        leadUpdate.delivery_same_as_billing = sameAsBilling;
      }
      if (sameAsBilling === false) {
        for (const f of DELIVERY_FIELDS) {
          const v = cleanString(body[f]);
          if (v !== null) leadUpdate[f] = v;
        }
      }
    }

    // Onthoud welke velden de klant heeft meegestuurd voor activity-log + notificatie
    const customerFieldKeys = Object.keys(leadUpdate).filter(
      (k) => k !== "status" && k !== "won_at"
    );
    if (customerFieldKeys.length > 0) {
      customerInput = customerFieldKeys.reduce((acc, k) => {
        acc[k] = leadUpdate[k];
        return acc;
      }, {});
    }

    await supabase
      .from("leads")
      .update(leadUpdate)
      .eq("id", quote.lead_id);

    // Log activity
    const baseDescription = `Offerte ${quote.quote_number} geaccepteerd door klant via publieke link`;
    const description = customerInput
      ? `${baseDescription} — klant heeft NAW-gegevens bevestigd/aangevuld`
      : baseDescription;
    await supabase.from("activities").insert({
      lead_id: quote.lead_id,
      activity_type: "quote_accepted",
      description,
      created_by: "Klant",
      tenant,
    });

    // Send notification email to team
    await sendAcceptanceNotification(quote, tenant, customerInput);
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

function renderAddressBlock(prefix, input) {
  const street = input[`${prefix}_street`];
  const houseNumber = input[`${prefix}_house_number`];
  const postal = input[`${prefix}_postal_code`];
  const city = input[`${prefix}_city`];
  const country = input[`${prefix}_country`];
  if (!street && !houseNumber && !postal && !city && !country) return "";
  const line1 = [street, houseNumber].filter(Boolean).join(" ");
  const line2 = [postal, city].filter(Boolean).join(" ");
  return [line1, line2, country].filter(Boolean).join("<br>");
}

function renderCustomerInputBlock(input) {
  if (!input) return "";

  const billing = renderAddressBlock("billing", input);
  const delivery = renderAddressBlock("delivery", input);
  const billingEmail = input.billing_email;
  const reference = input.customer_reference;
  const sameAsBilling = input.delivery_same_as_billing;

  const rows = [];
  if (billing) {
    rows.push(`
      <tr>
        <td style="padding: 6px 0; color: #6b7280; vertical-align: top;">Factuuradres</td>
        <td style="padding: 6px 0;">${billing}</td>
      </tr>`);
  }
  if (sameAsBilling === false && delivery) {
    rows.push(`
      <tr>
        <td style="padding: 6px 0; color: #6b7280; vertical-align: top;">Leveradres</td>
        <td style="padding: 6px 0;">${delivery}</td>
      </tr>`);
  } else if (sameAsBilling === true && billing) {
    rows.push(`
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Leveradres</td>
        <td style="padding: 6px 0; color: #6b7280; font-style: italic;">Gelijk aan factuuradres</td>
      </tr>`);
  }
  if (billingEmail) {
    rows.push(`
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Factuur-e-mail</td>
        <td style="padding: 6px 0;">${billingEmail}</td>
      </tr>`);
  }
  if (reference) {
    rows.push(`
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Referentie / PO</td>
        <td style="padding: 6px 0;">${reference}</td>
      </tr>`);
  }

  if (rows.length === 0) return "";

  return `
    <h3 style="margin: 28px 0 8px; font-size: 15px; color: #0D0D0F;">Door klant bevestigd</h3>
    <table style="width: 100%; font-size: 14px; color: #374151;">
      ${rows.join("")}
    </table>
  `;
}

async function sendAcceptanceNotification(quote, tenant, customerInput = null) {
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
      ${renderCustomerInputBlock(customerInput)}
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
