import { supabase } from "@/lib/supabase";
import { Resend } from "resend";
import { wrapEmailHtml } from "@/lib/email-template";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://hiphot.nl",
  "https://www.hiphot.nl",
  "https://48-7.nl",
  "https://www.48-7.nl",
  "http://localhost:3000",
  "http://localhost:3001",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Preflight
export async function OPTIONS(request) {
  const origin = request.headers.get("origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function getResendKey(tenant) {
  if (tenant === "hiphot" && process.env.RESEND_API_KEY_HIPHOT) return process.env.RESEND_API_KEY_HIPHOT;
  if (tenant === "48-7" && process.env.RESEND_API_KEY_487) return process.env.RESEND_API_KEY_487;
  return process.env.RESEND_API_KEY;
}

const TENANT_CONFIG = {
  hiphot: {
    fromEmail: "hallo@hiphot.nl",
    fromName: "HipHot",
    notifyEmail: "hallo@hiphot.nl",
  },
  "48-7": {
    fromEmail: "hallo@48-7.nl",
    fromName: "48-7 AI Professionals",
    notifyEmail: "hallo@48-7.nl",
  },
};

const CLOSINGS = {
  hiphot: {
    nl: "Met zonnige groet,",
    en: "With sunny regards,",
    de: "Mit sonnigen Grüßen,",
  },
  "48-7": {
    nl: "Met vriendelijke groet,",
    en: "Kind regards,",
    de: "Mit freundlichen Grüßen,",
  },
};

const TRANSLATIONS = {
  nl: {
    confirmSubject: "Bedankt voor je bericht",
    confirmBody: (firstName, tenant) => `
      <p>Hallo ${firstName},</p>
      <p>Bedankt voor je bericht! We hebben je aanvraag ontvangen en nemen zo snel mogelijk contact met je op.</p>
      <p>${CLOSINGS[tenant]?.nl || CLOSINGS["48-7"].nl}</p>
    `,
  },
  en: {
    confirmSubject: "Thank you for your message",
    confirmBody: (firstName, tenant) => `
      <p>Hello ${firstName},</p>
      <p>Thank you for your message! We have received your inquiry and will get back to you as soon as possible.</p>
      <p>${CLOSINGS[tenant]?.en || CLOSINGS["48-7"].en}</p>
    `,
  },
  de: {
    confirmSubject: "Vielen Dank für Ihre Nachricht",
    confirmBody: (firstName, tenant) => `
      <p>Hallo ${firstName},</p>
      <p>Vielen Dank für Ihre Nachricht! Wir haben Ihre Anfrage erhalten und werden uns so schnell wie möglich bei Ihnen melden.</p>
      <p>${CLOSINGS[tenant]?.de || CLOSINGS["48-7"].de}</p>
    `,
  },
};

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  try {
    const body = await request.json();
    const {
      tenant, first_name, last_name, email, phone, message, language, source_url, _hp,
      gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      referrer, lead_type,
    } = body;

    // Honeypot check — if filled, silently succeed (bot)
    if (_hp) {
      return Response.json({ success: true }, { headers });
    }

    // Trim/cap tracking-velden; lege strings → null zodat we lead-data niet
    // overschrijven met "" als een latere submit zonder klik-context binnenkomt.
    const cleanTrack = (v) => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > 0 ? t.slice(0, 500) : null;
    };
    const tracking = {
      gclid: cleanTrack(gclid),
      gbraid: cleanTrack(gbraid),
      wbraid: cleanTrack(wbraid),
      utm_source: cleanTrack(utm_source),
      utm_medium: cleanTrack(utm_medium),
      utm_campaign: cleanTrack(utm_campaign),
      utm_content: cleanTrack(utm_content),
      utm_term: cleanTrack(utm_term),
      referrer: cleanTrack(referrer),
      lead_type: cleanTrack(lead_type) || "contact",
    };

    // Validate required fields
    if (!tenant || !first_name || !last_name || !email || !message) {
      return Response.json(
        { error: "Alle verplichte velden moeten ingevuld zijn" },
        { status: 400, headers }
      );
    }

    // Validate tenant
    const config = TENANT_CONFIG[tenant];
    if (!config) {
      return Response.json({ error: "Ongeldige tenant" }, { status: 400, headers });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Ongeldig e-mailadres" }, { status: 400, headers });
    }

    // Rate limiting: max 5 submissions per email per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("email", email.toLowerCase())
      .gte("created_at", oneHourAgo);

    if (count >= 5) {
      return Response.json(
        { error: "Te veel aanvragen. Probeer het later opnieuw." },
        { status: 429, headers }
      );
    }

    const lang = language || "nl";
    const fullName = `${first_name} ${last_name}`.trim();

    // 1. Check for existing lead by email
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("tenant", tenant)
      .ilike("email", email.trim())
      .limit(1)
      .maybeSingle();

    let leadId = existingLead?.id;

    // 2. Create new lead if not found
    if (!leadId) {
      const defaultStatus = tenant === "hiphot" ? "nieuwe_aanvraag" : "nieuw";
      const leadInsert = {
        company_name: `${fullName} (contactformulier)`,
        contact_person: fullName,
        contact_first_name: first_name.trim(),
        contact_last_name: last_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone || null,
        source: "website",
        status: defaultStatus,
        language: lang,
        tenant,
      };
      // Eerste-touchpoint wint: tracking alleen bij nieuwe lead op leads-tabel.
      // Bestaande leads krijgen attributie alleen via form_submission per touchpoint
      // — anders zou een tweede submit zonder gclid de oorspronkelijke klik wissen.
      for (const [k, v] of Object.entries(tracking)) {
        if (v !== null) leadInsert[k] = v;
      }
      const { data: newLead } = await supabase
        .from("leads")
        .insert(leadInsert)
        .select("id")
        .single();

      leadId = newLead?.id;

      // Log lead creation
      if (leadId) {
        await supabase.from("activities").insert({
          lead_id: leadId,
          activity_type: "lead_created",
          description: `Lead aangemaakt via contactformulier: ${fullName}`,
          created_by: "Contactformulier",
          tenant,
        });
      }
    }

    // 3. Insert form submission (incl. tracking-attributie van dit touchpoint)
    const { data: submission } = await supabase
      .from("form_submissions")
      .insert({
        tenant,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone || null,
        message: message.trim(),
        language: lang,
        source_url: source_url || null,
        lead_id: leadId || null,
        status: "nieuw",
        ...tracking,
      })
      .select("id")
      .single();

    // 4. Create note on lead
    if (leadId) {
      await supabase.from("notes").insert({
        lead_id: leadId,
        content: `**Contactformulier**\n\n${message.trim()}\n\n---\n${fullName} — ${email}${phone ? ` — ${phone}` : ""}`,
        note_type: "formulier",
        tenant,
        created_by: "Contactformulier",
      });

      await supabase.from("activities").insert({
        lead_id: leadId,
        activity_type: "form_submission",
        description: `Contactformulier ingevuld door ${fullName}`,
        metadata: { form_submission_id: submission?.id },
        created_by: "Contactformulier",
        tenant,
      });
    }

    // 5. Send confirmation email to submitter
    const resend = new Resend(getResendKey(tenant));
    const t = TRANSLATIONS[lang] || TRANSLATIONS.nl;

    try {
      await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: [email.trim().toLowerCase()],
        subject: t.confirmSubject,
        html: wrapEmailHtml(t.confirmBody(first_name.trim(), tenant), { tenant }),
      });
    } catch (emailErr) {
      console.error("Confirmation email failed:", emailErr);
    }

    // 6. Send notification to team
    const crmUrl = `https://crm.48-7.nl/inbox?id=${submission?.id}`;
    const leadUrl = leadId ? `https://crm.48-7.nl/leads/${leadId}` : null;

    try {
      await resend.emails.send({
        from: `${config.fromName} CRM <${config.fromEmail}>`,
        to: [config.notifyEmail],
        subject: `Nieuwe contactaanvraag — ${fullName}`,
        html: wrapEmailHtml(`
          <h2 style="margin:0 0 16px; font-size:18px; color:#1a1a1a;">Nieuwe contactaanvraag</h2>
          <table style="width:100%; font-size:14px; color:#374151; border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0; color:#6b7280; width:120px; vertical-align:top;">Naam</td>
              <td style="padding:8px 0; font-weight:600;">${fullName}</td>
            </tr>
            <tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">E-mail</td>
              <td style="padding:8px 0;"><a href="mailto:${email}" style="color:#d97706;">${email}</a></td>
            </tr>
            ${phone ? `<tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">Telefoon</td>
              <td style="padding:8px 0;"><a href="tel:${phone}" style="color:#d97706;">${phone}</a></td>
            </tr>` : ""}
            <tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">Bericht</td>
              <td style="padding:8px 0;">${message.trim().replace(/\n/g, "<br>")}</td>
            </tr>
            ${source_url ? `<tr>
              <td style="padding:8px 0; color:#6b7280; vertical-align:top;">Pagina</td>
              <td style="padding:8px 0; font-size:12px; color:#9ca3af;">${source_url}</td>
            </tr>` : ""}
          </table>
          <div style="margin-top:24px; display:flex; gap:12px;">
            <a href="${crmUrl}" style="display:inline-block; background:${tenant === "hiphot" ? "#FFD500" : "#FAB868"}; color:#0D0D0F; font-weight:600; padding:10px 24px; border-radius:999px; text-decoration:none; font-size:14px;">
              Bekijk in CRM
            </a>
            ${leadUrl ? `<a href="${leadUrl}" style="display:inline-block; background:#f3f4f6; color:#374151; font-weight:500; padding:10px 24px; border-radius:999px; text-decoration:none; font-size:14px; margin-left:8px;">
              Bekijk lead
            </a>` : ""}
          </div>
        `, { tenant }),
      });
    } catch (notifyErr) {
      console.error("Team notification failed:", notifyErr);
    }

    return Response.json({ success: true }, { headers });
  } catch (err) {
    console.error("Form submission error:", err);
    return Response.json(
      { error: "Er ging iets mis" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
