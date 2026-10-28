import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordNewsletterEvent } from "@/lib/newsletters";
import { verifyUnsubscribeSignature } from "@/lib/newsletter-unsubscribe";

export const dynamic = "force-dynamic";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function page({ title, message, form = "" }, status = 200) {
  const html = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F5F3EE;font-family:Arial,Helvetica,sans-serif;color:#1C1C1C;">
<div style="max-width:480px;margin:64px auto;padding:32px 28px;background:#fff;border-radius:12px;">
<h1 style="margin:0 0 12px;font-size:22px;">${esc(title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:#4B5563;">${message}</p>${form}
</div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const INVALID = {
  title: "Link werkt niet",
  message: "Deze uitschrijflink is ongeldig of verlopen. Antwoord op de nieuwsbrief, dan schrijven we je handmatig uit.",
};

async function findRecipient(recipientId, signature) {
  if (!verifyUnsubscribeSignature(recipientId, signature)) return null;
  const { data } = await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .select("id, tenant, campaign_id, contact_id, email")
    .eq("id", recipientId)
    .maybeSingle();
  return data || null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("preview") === "1") {
    return page({
      title: "Uitschrijven (test)",
      message: "Dit is een testmail. In de echte nieuwsbrief schrijft deze link de ontvanger direct uit.",
    });
  }

  const recipientId = searchParams.get("r");
  const signature = searchParams.get("s");
  const recipient = await findRecipient(recipientId, signature);
  if (!recipient) return page(INVALID, 400);

  const action = `?${new URLSearchParams({ r: recipientId, s: signature })}`;
  return page({
    title: "Uitschrijven voor de nieuwsbrief",
    message: `Wil je <strong>${esc(recipient.email)}</strong> uitschrijven? Je ontvangt daarna geen nieuwsbrieven meer op dit adres.`,
    form: `<form method="post" action="${esc(action)}"><button type="submit" style="background:#1C1C1C;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;cursor:pointer;">Ja, schrijf mij uit</button></form>`,
  });
}

// Bevestigingsformulier én one-click (RFC 8058, body "List-Unsubscribe=One-Click").
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const recipient = await findRecipient(searchParams.get("r"), searchParams.get("s"));
  if (!recipient) return page(INVALID, 400);

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("newsletter_email_suppressions")
    .upsert(
      {
        tenant: recipient.tenant,
        email: recipient.email,
        status: "unsubscribed",
        reason: "unsubscribe_link",
        source: "unsubscribe_link",
        suppressed_at: now,
        updated_at: now,
      },
      { onConflict: "tenant,email" }
    );
  if (error) {
    return page({ title: "Er ging iets mis", message: "Probeer het later opnieuw of antwoord op de nieuwsbrief." }, 500);
  }

  // Zelfde gedrag als de Resend-webhook bij een afmelding.
  const contactUpdate = supabaseAdmin.from("contacts").update({ marketing_consent: false }).eq("tenant", recipient.tenant);
  await (recipient.contact_id ? contactUpdate.eq("id", recipient.contact_id) : contactUpdate.eq("email", recipient.email));

  await supabaseAdmin
    .from("newsletter_campaign_recipients")
    .update({ status: "unsubscribed", last_event_at: now, updated_at: now })
    .eq("id", recipient.id);

  const oneClick = (request.headers.get("content-type") || "").includes("form")
    && (await request.text()).includes("List-Unsubscribe=One-Click");
  await recordNewsletterEvent({
    tenant: recipient.tenant,
    campaign_id: recipient.campaign_id,
    recipient_id: recipient.id,
    event_type: "unsubscribed",
    email: recipient.email,
    payload: { source: oneClick ? "one_click" : "unsubscribe_page" },
    occurred_at: now,
  });

  return page({
    title: "Je bent uitgeschreven",
    message: `We sturen geen nieuwsbrieven meer naar <strong>${esc(recipient.email)}</strong>. Per ongeluk? Antwoord op een eerdere nieuwsbrief, dan zetten we je terug.`,
  });
}
