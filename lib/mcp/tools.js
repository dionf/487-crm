/**
 * Tools van het remote MCP-endpoint (/api/mcp).
 *
 * Zelfde tools als de lokale extensie (~/Code/487crm-mcp), maar elke aanroep
 * draait als de ingelogde gebruiker:
 *   - de tenant volgt uit diens organisatie; er is geen `tenant`-parameter;
 *   - elk record dat via een id binnenkomt wordt op die tenant gecontroleerd;
 *   - created_by / uploaded_by is de naam van de gebruiker;
 *   - de rate-limitpolicies voor sessies tellen per gebruiker.
 */

import { z } from "zod";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { signToken } from "@/lib/auth";
import { addContact, ensurePrimaryContactForLead } from "@/lib/contacts";
import { getRelationTypes, relationLabel } from "@/lib/constants";
import {
  contactNewsletterState,
  escapeLikePattern,
  fetchNewsletterSuppressions,
  isLeadNewsletterSubscribed,
  normalizeEmail,
  setEmailSubscription,
} from "@/lib/newsletters";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WON_STATUSES = ["gewonnen", "offerte_gewonnen"];
const LOST_STATUSES = ["verloren", "offerte_verloren"];
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

const LEAD_STATUSES = {
  "48-7": "nieuw, gekwalificeerd, inventarisatie, offerte_verstuurd, onderhandeling, gewonnen, verloren, geen_lead",
  hiphot: "prospect, nieuwe_aanvraag, terugbellen, offerte_gestuurd, reminder_gestuurd, offerte_in_de_wacht, in_overweging, offerte_gewonnen, offerte_verloren, geen_lead",
};

const MIME_TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json", html: "text/html", txt: "text/plain", csv: "text/csv",
};

// Domeinen van gratis mailboxen zeggen niets over het bedrijf; daarop zoeken
// we geen dubbelingen.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.nl", "hotmail.com", "hotmail.nl",
  "live.com", "live.nl", "msn.com", "icloud.com", "me.com", "yahoo.com", "yahoo.nl",
  "ziggo.nl", "kpnmail.nl", "planet.nl", "home.nl", "xs4all.nl", "telfort.nl", "hetnet.nl", "proton.me", "protonmail.com",
]);

const NEWSLETTER_STATE_TEXT = {
  receives: "ontvangt nieuwsbrief",
  company_off: "nieuwsbrief uit (bedrijf staat uit)",
  unsubscribed: "uitgeschreven",
  bounced: "geblokkeerd na bounce/klacht",
  no_email: "geen e-mailadres",
};

const RELATION_COLUMNS = "id, company_name, status, in_pipeline, relationship_type, website_url, email, marketing_consent, marketing_subscription_status, marketing_hard_bounced, contacts(id, name, email, role, is_primary)";

function companyDomain(email) {
  const normalized = normalizeEmail(email);
  const domain = normalized ? normalized.split("@")[1] : "";
  return domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : "";
}

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });

// PostgREST-filters in .or() gebruiken komma's en haakjes als syntax; die uit
// zoektermen halen zodat een zoekterm het filter niet kan openbreken.
function cleanTerm(value) {
  return String(value || "").replace(/[,()*%\\]/g, " ").trim().slice(0, 100);
}

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {{ user: { id: string, name: string, email: string, role: string }, tenant: string, orgName: string, origin: string, request: Request }} ctx
 */
export function registerCrmTools(server, ctx) {
  const { user, tenant, request } = ctx;
  const actor = user.name || user.email;
  const statusDesc = `Status-waardes voor deze organisatie: ${LEAD_STATUSES[tenant] || LEAD_STATUSES["48-7"]}`;

  // Elke tool telt mee tegen de bestaande sessielimieten van de gebruiker.
  function tool(name, kind, description, schema, handler) {
    server.registerTool(name, { description, inputSchema: schema }, async (args) => {
      const gate = await enforceRateLimit({
        request,
        policy: `session-${kind}`,
        identifier: user.id,
        scope: `/api/mcp#${name}`,
        tenant,
      });
      if (gate.response) {
        const retry = gate.response.headers.get("Retry-After");
        return fail(`Te veel verzoeken. Probeer het over ${retry || "even"} seconden opnieuw.`);
      }
      try {
        return await handler(args || {});
      } catch (err) {
        console.error(`[mcp] ${name} faalde voor ${user.id}:`, err);
        return fail(`Fout: ${err.message || "onbekende fout"}`);
      }
    });
  }

  async function logActivity(leadId, activity_type, description, metadata) {
    await supabase.from("activities").insert({
      lead_id: leadId, activity_type, description, metadata: metadata || null, created_by: actor, tenant,
    });
  }

  // Lead op id of (deel van de) bedrijfsnaam, altijd binnen de eigen tenant.
  // Een id uit een andere tenant geeft hetzelfde antwoord als een onbekend id.
  async function findLead({ lead_id, company_name }, columns = "id, company_name, tenant") {
    if (lead_id) {
      if (!UUID_RE.test(lead_id)) return null;
      const { data } = await supabase.from("leads").select(columns).eq("id", lead_id).eq("tenant", tenant).maybeSingle();
      return data || null;
    }
    const term = cleanTerm(company_name);
    if (!term) return null;
    const { data } = await supabase
      .from("leads").select(columns).eq("tenant", tenant).ilike("company_name", `%${term}%`)
      .order("created_at", { ascending: false }).limit(1);
    return data?.[0] || null;
  }

  async function updateOpportunityValue(opportunityId) {
    if (!opportunityId) return;
    const { data: quotes } = await supabase
      .from("quotes").select("amount_excl_vat").eq("opportunity_id", opportunityId).neq("status", "afgewezen");
    const total = (quotes || []).reduce((s, q) => s + (Number(q.amount_excl_vat) || 0), 0);
    await supabase.from("opportunities").update({ estimated_value: total }).eq("id", opportunityId).eq("tenant", tenant);
  }

  const leadRef = {
    lead_id: z.string().optional().describe("UUID van de lead (bedrijf)"),
    company_name: z.string().optional().describe("Bedrijfsnaam, of een deel ervan, als je geen ID hebt"),
  };

  // --- Wie ben ik ---
  tool(
    "crm_whoami",
    "read",
    "Toon als wie deze koppeling werkt: naam, e-mail, rol en organisatie (tenant). Alle tools werken alleen binnen deze organisatie.",
    {},
    async () =>
      text(`Ingelogd als **${user.name}** (${user.email}) — rol: ${user.role}\nOrganisatie: **${ctx.orgName}** (tenant \`${tenant}\`)\nCRM: ${ctx.origin}\n\nAlle acties worden vastgelegd op naam van ${actor}.`)
  );

  // --- Zoeken ---
  tool(
    "crm_search_leads",
    "search",
    "Zoek leads (bedrijven) in het CRM van je organisatie op bedrijfsnaam, contactpersoon of e-mail.",
    {
      query: z.string().optional().describe("Zoekterm (bedrijfsnaam, contactpersoon, e-mail)"),
      status: z.string().optional().describe(`Filter op status. ${statusDesc}`),
      service_type: z.string().optional().describe("Filter op service type"),
    },
    async ({ query, status, service_type }) => {
      let q = supabase
        .from("leads")
        .select("id, company_name, contact_person, email, phone, status, service_type, estimated_value, created_at")
        .eq("tenant", tenant).order("created_at", { ascending: false }).limit(25);
      const term = cleanTerm(query);
      if (term) {
        q = q.or(["company_name", "contact_person", "contact_first_name", "contact_last_name", "email"]
          .map((c) => `${c}.ilike.%${term}%`).join(","));
      }
      if (status) q = q.eq("status", status);
      if (service_type) q = q.eq("service_type", service_type);
      const { data, error } = await q;
      if (error) return fail(`Fout: ${error.message}`);
      if (!data?.length) return text("Geen leads gevonden.");
      const lines = data.map((l) =>
        `• **${l.company_name}** (${l.status}) — ${l.contact_person || "-"} — ${l.email || "-"}${l.estimated_value ? ` — €${l.estimated_value}` : ""}${l.service_type ? ` — ${l.service_type}` : ""} — id ${l.id}`
      );
      return text(`**${data.length} leads gevonden:**\n\n${lines.join("\n")}`);
    }
  );

  // --- Lead details ---
  tool(
    "crm_get_lead",
    "read",
    "Haal alle details van een lead op: contactgegevens, trajecten, offertes, notities, bijlagen en recente activiteiten.",
    leadRef,
    async (args) => {
      const lead = await findLead(args, "*");
      if (!lead) return text("Lead niet gevonden.");

      const [notesRes, quotesRes, activitiesRes, attachRes, oppRes] = await Promise.all([
        supabase.from("notes").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(20),
        supabase.from("quotes").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
        supabase.from("activities").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(10),
        supabase.from("attachments").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
        supabase.from("opportunities").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
      ]);
      const notes = notesRes.data || [];
      const quotes = quotesRes.data || [];
      const activities = activitiesRes.data || [];
      const attachments = attachRes.data || [];
      const opportunities = oppRes.data || [];

      let t = `# ${lead.company_name}\n`;
      t += `**Lead ID:** ${lead.id}\n`;
      t += `**Status (huidig traject):** ${lead.status}\n`;
      const contactName = lead.contact_first_name && lead.contact_last_name
        ? `${lead.contact_first_name} ${lead.contact_last_name}` : lead.contact_person;
      t += `**Contact:** ${contactName || "-"} — ${lead.email || "-"}${lead.phone ? ` — ${lead.phone}` : ""}\n`;
      if (lead.contact_function) t += `**Functie:** ${lead.contact_function}\n`;
      if (lead.service_type) t += `**Service:** ${lead.service_type}\n`;
      if (lead.estimated_value) t += `**Waarde:** €${lead.estimated_value}\n`;
      if (lead.source) t += `**Bron:** ${lead.source}\n`;
      if (lead.website_url) t += `**Website:** ${lead.website_url}\n`;
      if (lead.city) t += `**Plaats:** ${lead.city}\n`;
      t += `**In CRM:** ${ctx.origin}/leads/${lead.id}\n`;
      if (lead.ai_summary) t += `\n**AI-analyse:**\n${lead.ai_summary}\n`;

      if (opportunities.length) {
        t += `\n## Trajecten (${opportunities.length})\n`;
        opportunities.forEach((o) => {
          t += `• **${o.name}** (${o.id}) — ${o.status}${o.estimated_value ? ` — €${o.estimated_value}` : ""}${o.service_type ? ` — ${o.service_type}` : ""}${o.lost_reason ? ` — reden: ${o.lost_reason}` : ""}\n`;
        });
      }
      if (quotes.length) {
        const oppName = (id) => opportunities.find((o) => o.id === id)?.name;
        t += `\n## Offertes (${quotes.length})\n`;
        quotes.forEach((q) => {
          t += `• ${q.quote_number} — €${q.amount_excl_vat} — ${q.status}${oppName(q.opportunity_id) ? ` — traject: ${oppName(q.opportunity_id)}` : ""}${q.description ? ` — ${q.description}` : ""}\n`;
        });
      }
      if (notes.length) {
        t += `\n## Notities (${notes.length})\n`;
        notes.slice(0, 10).forEach((n) => {
          const date = new Date(n.created_at).toLocaleDateString("nl-NL");
          const content = n.content || "";
          t += `• [${n.note_type}] ${content.substring(0, 150)}${content.length > 150 ? "..." : ""} (${date}${n.created_by ? ` door ${n.created_by}` : ""})\n`;
        });
      }
      if (attachments.length) {
        t += `\n## Bijlagen (${attachments.length})\n`;
        attachments.forEach((a) => {
          const size = a.file_size ? `${Math.round(a.file_size / 1024)} KB` : "";
          t += `• ${a.file_name || a.filename}${size ? ` (${size})` : ""}${a.description ? ` — ${a.description}` : ""}\n`;
        });
      }
      if (activities.length) {
        t += `\n## Recente activiteiten\n`;
        activities.slice(0, 5).forEach((a) => {
          t += `• ${a.description} (${new Date(a.created_at).toLocaleDateString("nl-NL")}${a.created_by ? `, ${a.created_by}` : ""})\n`;
        });
      }
      return text(t);
    }
  );

  // --- Lead aanmaken ---
  tool(
    "crm_create_lead",
    "write",
    "Maak een nieuwe lead (bedrijf met verkoopkans) aan in de pipeline van je organisatie. Voor een contact zonder concrete verkoopkans (bijv. uit de mail): gebruik crm_create_relation. Voor een nieuwe kans bij een bestaand bedrijf: crm_create_opportunity.",
    {
      company_name: z.string().min(1).describe("Bedrijfsnaam"),
      contact_first_name: z.string().describe("Voornaam contactpersoon"),
      contact_last_name: z.string().describe("Achternaam contactpersoon"),
      contact_function: z.string().optional().describe("Functie contactpersoon"),
      email: z.string().describe("E-mailadres"),
      phone: z.string().optional().describe("Telefoonnummer"),
      service_type: z.string().optional().describe("Service type"),
      estimated_value: z.number().optional().describe("Geschatte waarde in euro"),
      source: z.string().optional().describe("Bron: linkedin, website, referral, partner, event, overig"),
    },
    async ({ company_name, contact_first_name, contact_last_name, contact_function, email, phone, service_type, estimated_value, source }) => {
      const contact_person = `${contact_first_name} ${contact_last_name}`.trim();
      const { data, error } = await supabase.from("leads").insert({
        tenant, company_name, contact_person, contact_first_name, contact_last_name,
        contact_function: contact_function || null, email, phone: phone || null,
        service_type: service_type || null, estimated_value: estimated_value ?? null,
        source: source || "overig", status: tenant === "hiphot" ? "nieuwe_aanvraag" : "nieuw",
        assigned_to: user.id,
      }).select().single();
      if (error) return fail(`Fout: ${error.message}`);
      await ensurePrimaryContactForLead(data.id, tenant);
      await logActivity(data.id, "lead_created", `Lead aangemaakt: ${company_name}`);
      return text(`Lead aangemaakt: **${company_name}** (${data.id})\nStatus: ${data.status}\n${ctx.origin}/leads/${data.id}`);
    }
  );

  // --- Relaties en contacten ---

  const relationTypes = getRelationTypes(tenant);
  const relationTypeIds = relationTypes.map((type) => type.id);
  const relationTypeDesc = relationTypes.map((type) => `${type.id} (${type.label})`).join(", ");

  async function loadRelations(leadIds) {
    if (!leadIds.length) return [];
    const { data, error } = await supabase
      .from("leads").select(RELATION_COLUMNS).eq("tenant", tenant).in("id", leadIds)
      .order("company_name", { ascending: true });
    if (error) throw new Error(error.message);
    const emails = (data || []).flatMap((lead) => [lead.email, ...(lead.contacts || []).map((c) => c.email)]);
    const suppressions = await fetchNewsletterSuppressions(tenant, emails);
    return (data || []).map((lead) => ({ lead, suppressions }));
  }

  function formatRelation({ lead, suppressions }) {
    const label = lead.relationship_type ? relationLabel(tenant, lead.relationship_type) : "";
    const place = lead.in_pipeline === false
      ? `relatie buiten pipeline${label ? ` (${label})` : ""}`
      : `pipeline: ${lead.status}${label ? `, label ${label}` : ""}`;
    const company = isLeadNewsletterSubscribed(lead) ? "nieuwsbrief bedrijf aan" : "nieuwsbrief bedrijf uit";
    let t = `• **${lead.company_name}** — ${place} — ${company} — id ${lead.id}\n`;
    const contacts = lead.contacts || [];
    const contactEmails = new Set(contacts.map((c) => normalizeEmail(c.email)).filter(Boolean));
    for (const c of contacts) {
      const state = contactNewsletterState(lead, c.email, suppressions.get(normalizeEmail(c.email)));
      t += `   – ${c.name}${c.role ? ` (${c.role})` : ""}${c.is_primary ? " [primair]" : ""} — ${c.email || "-"} — ${NEWSLETTER_STATE_TEXT[state.state]}\n`;
    }
    const general = normalizeEmail(lead.email);
    if (general && !contactEmails.has(general)) {
      const state = contactNewsletterState(lead, general, suppressions.get(general));
      t += `   – algemeen adres — ${general} — ${NEWSLETTER_STATE_TEXT[state.state]}\n`;
    }
    if (!contacts.length && !general) t += "   – (nog geen contactpersonen)\n";
    return t;
  }

  // Bedrijven die mogelijk al bestaan: zelfde contactadres, zelfde
  // e-maildomein (geen gratis mailbox) of een vergelijkbare naam.
  async function findPossibleDuplicates({ companyName, email }) {
    const ids = new Set();
    const normalized = normalizeEmail(email);
    const domain = companyDomain(email);
    const name = cleanTerm(companyName);

    const lookups = [];
    if (normalized) {
      lookups.push(supabase.from("contacts").select("lead_id").eq("tenant", tenant).ilike("email", escapeLikePattern(normalized)));
      lookups.push(supabase.from("leads").select("id").eq("tenant", tenant).ilike("email", escapeLikePattern(normalized)));
    }
    if (domain) {
      const pattern = `%@${escapeLikePattern(domain)}`;
      lookups.push(supabase.from("contacts").select("lead_id").eq("tenant", tenant).ilike("email", pattern));
      lookups.push(supabase.from("leads").select("id").eq("tenant", tenant).or(`email.ilike.${pattern},website_url.ilike.%${escapeLikePattern(domain)}%`));
    }
    if (name.length >= 3) {
      lookups.push(supabase.from("leads").select("id").eq("tenant", tenant).ilike("company_name", `%${escapeLikePattern(name)}%`));
    }
    const results = await Promise.all(lookups);
    for (const { data } of results) {
      for (const row of data || []) ids.add(row.lead_id || row.id);
    }
    return [...ids].filter(Boolean).slice(0, 10);
  }

  // Zet het bedrijf op "ontvangt nieuwsbrief" met de toestemmingsgrond. De
  // andere adressen van het bedrijf ontvingen tot nu toe niets; die blijven
  // uit (adresblokkade), zodat aanzetten voor één persoon niet stilletjes de
  // hele organisatie inschrijft.
  async function switchCompanyNewsletterOn(lead, exceptEmail, reason) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("leads").update({
      marketing_consent: true,
      marketing_subscription_status: "subscribed",
      marketing_consent_source: reason,
      marketing_consent_date: now,
    }).eq("id", lead.id).eq("tenant", tenant);
    if (error) throw new Error(error.message);

    const { data: contacts } = await supabase.from("contacts").select("email").eq("lead_id", lead.id).eq("tenant", tenant);
    const others = [...new Set([lead.email, ...(contacts || []).map((c) => c.email)].map(normalizeEmail).filter(Boolean))]
      .filter((address) => address !== exceptEmail);
    const suppressions = await fetchNewsletterSuppressions(tenant, others);
    const kept = [];
    for (const address of others) {
      if (suppressions.has(address)) continue;
      await setEmailSubscription({
        tenant, email: address, subscribed: false, userName: actor,
        reason: `nog geen toestemming (bedrijf aangezet via Claude door ${actor})`,
      });
      kept.push(address);
    }
    return kept;
  }

  // Past de nieuwsbriefkeuze toe voor één adres van een bedrijf.
  async function applyNewsletterChoice(lead, email, wantsNewsletter, reason) {
    const address = normalizeEmail(email);
    if (!address) return "geen e-mailadres, dus geen nieuwsbrief";
    if (wantsNewsletter) {
      if (lead.marketing_hard_bounced) return "bedrijf is geblokkeerd na een bounce; nieuwsbrief alleen in het CRM aan te zetten";
      const suppression = (await fetchNewsletterSuppressions(tenant, [address])).get(address);
      if (suppression?.status === "hard_bounce") return "adres is geblokkeerd na een bounce of klacht; alleen in het CRM te deblokkeren";
      let note = "";
      if (!isLeadNewsletterSubscribed(lead)) {
        const kept = await switchCompanyNewsletterOn(lead, address, reason);
        note = kept.length ? ` (bedrijf aangezet; ${kept.join(", ")} blijft uit)` : " (bedrijf aangezet)";
      }
      await setEmailSubscription({ tenant, email: address, subscribed: true, userName: actor, reason });
      return `ontvangt nieuwsbrief${note}`;
    }
    if (isLeadNewsletterSubscribed(lead)) {
      await setEmailSubscription({
        tenant, email: address, subscribed: false, userName: actor,
        reason: reason || `toegevoegd via Claude door ${actor}, zonder nieuwsbrieftoestemming`,
      });
    }
    return "geen nieuwsbrief";
  }

  const newsletterFields = {
    nieuwsbrief: z.boolean().optional().describe("Moet dit adres de nieuwsbrief krijgen? Standaard false. Alleen true als er een toestemmingsgrond is (bestaande klant, zelf aangemeld, expliciet gevraagd)."),
    nieuwsbrief_reden: z.string().optional().describe("Verplicht bij nieuwsbrief=true: de toestemmingsgrond, bijv. 'bestaande klant' of 'vroeg om nieuwsbrief in mail van 12 okt'."),
  };

  tool(
    "crm_search_relations",
    "search",
    "Zoek bedrijven en contactpersonen in het CRM op bedrijfsnaam, naam, e-mailadres of e-maildomein (bijv. 'jansen.nl'). Toont per bedrijf of het in de pipeline zit of een relatie is (Klant, Partner, Alleen nieuwsbrief), de contactpersonen en per adres de nieuwsbriefstatus. Gebruik dit ALTIJD eerst voordat je een relatie of contact aanmaakt, om dubbelingen te voorkomen.",
    {
      query: z.string().min(2).describe("Bedrijfsnaam, persoonsnaam, e-mailadres of domein"),
    },
    async ({ query }) => {
      const term = cleanTerm(query);
      if (term.length < 2) return text("Geef een zoekterm van minstens 2 tekens.");
      const like = `%${escapeLikePattern(term)}%`;
      const domain = term.includes("@") ? term.split("@").pop() : (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(term) ? term : "");
      const domainLike = domain ? `%${escapeLikePattern(domain)}%` : null;

      const [leadRes, contactRes] = await Promise.all([
        supabase.from("leads").select("id").eq("tenant", tenant)
          .or([
            `company_name.ilike.${like}`, `contact_person.ilike.${like}`, `email.ilike.${like}`,
            ...(domainLike ? [`email.ilike.${domainLike}`, `website_url.ilike.${domainLike}`] : []),
          ].join(",")).limit(25),
        supabase.from("contacts").select("lead_id").eq("tenant", tenant)
          .or([`name.ilike.${like}`, `email.ilike.${like}`, ...(domainLike ? [`email.ilike.${domainLike}`] : [])].join(","))
          .limit(50),
      ]);
      if (leadRes.error) return fail(`Fout: ${leadRes.error.message}`);
      if (contactRes.error) return fail(`Fout: ${contactRes.error.message}`);
      const ids = [...new Set([...(leadRes.data || []).map((r) => r.id), ...(contactRes.data || []).map((r) => r.lead_id)])].slice(0, 25);
      if (!ids.length) return text(`Niets gevonden voor "${term}". Dit bedrijf of contact staat nog niet in het CRM.`);
      const relations = await loadRelations(ids);
      return text(`**${relations.length} bedrijf/bedrijven gevonden voor "${term}":**\n\n${relations.map(formatRelation).join("\n")}`);
    }
  );

  tool(
    "crm_create_relation",
    "write",
    `Maak een nieuw bedrijf aan met de eerste contactpersoon eronder. Standaard als relatie BUITEN de pipeline (bijv. een contact uit de mail); zet in_pipeline=true alleen als er een concrete verkoopkans is. Zoek eerst met crm_search_relations. Bij een mogelijke dubbeling maakt deze tool niets aan maar toont de treffers; voeg dan een contact toe aan het bestaande bedrijf met crm_add_contact. Werk je een lijst af (bijv. uit een mailscan), laat de gebruiker dan eerst de voorgestelde relaties zien en maak ze pas aan na akkoord.`,
    {
      company_name: z.string().min(1).describe("Bedrijfsnaam"),
      contact_name: z.string().min(1).describe("Volledige naam van de contactpersoon"),
      contact_email: z.string().min(3).describe("E-mailadres van de contactpersoon"),
      contact_role: z.string().optional().describe("Functie van de contactpersoon"),
      contact_phone: z.string().optional().describe("Telefoonnummer"),
      website_url: z.string().optional().describe("Website van het bedrijf"),
      in_pipeline: z.boolean().optional().describe("true = verkoopkans in de pipeline (status nieuw). Standaard false: relatie buiten de pipeline."),
      relationship_type: z.enum(relationTypeIds).optional().describe(`Label van de relatie: ${relationTypeDesc}`),
      service_type: z.string().optional().describe("Service type (alleen bij in_pipeline)"),
      estimated_value: z.number().optional().describe("Geschatte waarde in euro (alleen bij in_pipeline)"),
      source: z.string().optional().describe("Bron: email, linkedin, website, referral, partner, event, overig (standaard email)"),
      bron_toelichting: z.string().optional().describe("Waar komt dit contact vandaan, bijv. 'mailscan: mail van 12 okt over AI-training'. Wordt een notitie op het bedrijf."),
      ...newsletterFields,
      toch_aanmaken: z.boolean().optional().describe("Alleen true als de gebruiker na het zien van mogelijke dubbelingen bevestigt dat het een ander bedrijf is."),
    },
    async (a) => {
      const email = normalizeEmail(a.contact_email);
      if (!email) return fail("Ongeldig e-mailadres voor de contactpersoon.");
      if (a.nieuwsbrief && !a.nieuwsbrief_reden?.trim()) {
        return fail("Geef bij nieuwsbrief=true ook nieuwsbrief_reden op (de toestemmingsgrond).");
      }

      if (!a.toch_aanmaken) {
        const dupes = await findPossibleDuplicates({ companyName: a.company_name, email });
        if (dupes.length) {
          const relations = await loadRelations(dupes);
          return text(`**Niet aangemaakt: mogelijk bestaat dit bedrijf al.**\n\n${relations.map(formatRelation).join("\n")}\nIs het een van deze bedrijven? Voeg de persoon dan toe met crm_add_contact. Is het echt een ander bedrijf, roep crm_create_relation dan opnieuw aan met toch_aanmaken=true.`);
        }
      }

      const inPipeline = a.in_pipeline === true;
      const name = a.contact_name.trim();
      const nameParts = name.split(/\s+/);
      const { data: lead, error } = await supabase.from("leads").insert({
        tenant,
        company_name: a.company_name.trim(),
        contact_person: name,
        contact_first_name: nameParts[0] || "",
        contact_last_name: nameParts.slice(1).join(" "),
        contact_function: a.contact_role || null,
        email,
        phone: a.contact_phone || null,
        website_url: a.website_url || null,
        service_type: inPipeline ? a.service_type || null : null,
        estimated_value: inPipeline ? a.estimated_value ?? null : null,
        source: a.source || "email",
        status: tenant === "hiphot" ? "nieuwe_aanvraag" : "nieuw",
        in_pipeline: inPipeline,
        relationship_type: a.relationship_type || null,
        marketing_consent: false,
        assigned_to: user.id,
      }).select("id, company_name, email, marketing_consent, marketing_subscription_status, marketing_hard_bounced").single();
      if (error) return fail(`Fout: ${error.message}`);

      await addContact({ tenant, leadId: lead.id, name, email, phone: a.contact_phone, role: a.contact_role, isPrimary: true });
      await logActivity(lead.id, "lead_created", `${inPipeline ? "Lead" : "Relatie"} aangemaakt via Claude: ${lead.company_name}`);
      if (a.bron_toelichting?.trim()) {
        await supabase.from("notes").insert({
          lead_id: lead.id, content: `Bron: ${a.bron_toelichting.trim()}`, note_type: "intern", created_by: actor, user_id: user.id, tenant,
        });
      }
      const newsletter = await applyNewsletterChoice(lead, email, a.nieuwsbrief === true, a.nieuwsbrief_reden?.trim());

      const label = a.relationship_type ? relationLabel(tenant, a.relationship_type) : null;
      return text(`Aangemaakt: **${lead.company_name}** — ${inPipeline ? "in de pipeline (nieuw)" : `relatie buiten pipeline${label ? ` (${label})` : ""}`}\nContact: ${name} — ${email} — ${newsletter}\n${ctx.origin}/leads/${lead.id}`);
    }
  );

  tool(
    "crm_add_contact",
    "write",
    "Voeg een contactpersoon toe aan een bestaand bedrijf. Bestaat het adres al bij dit bedrijf, dan gebeurt er niets. Staat het adres bij een ander bedrijf, dan wordt het pas toegevoegd met toch_toevoegen=true.",
    {
      ...leadRef,
      name: z.string().min(1).describe("Volledige naam"),
      email: z.string().optional().describe("E-mailadres"),
      role: z.string().optional().describe("Functie"),
      phone: z.string().optional().describe("Telefoonnummer"),
      is_primary: z.boolean().optional().describe("Wordt dit het primaire contact van het bedrijf?"),
      ...newsletterFields,
      toch_toevoegen: z.boolean().optional().describe("Alleen true als de gebruiker bevestigt dat dit adres ook bij dit bedrijf hoort, terwijl het al bij een ander bedrijf staat."),
    },
    async (a) => {
      const lead = await findLead(a, "id, company_name, email, marketing_consent, marketing_subscription_status, marketing_hard_bounced");
      if (!lead) return text("Bedrijf niet gevonden. Zoek eerst met crm_search_relations.");
      const email = a.email ? normalizeEmail(a.email) : "";
      if (a.email && !email) return fail("Ongeldig e-mailadres.");
      if (a.nieuwsbrief && !a.nieuwsbrief_reden?.trim()) {
        return fail("Geef bij nieuwsbrief=true ook nieuwsbrief_reden op (de toestemmingsgrond).");
      }

      if (email) {
        const { data: existing } = await supabase.from("contacts").select("lead_id, name, leads(company_name)")
          .eq("tenant", tenant).ilike("email", escapeLikePattern(email));
        const here = (existing || []).find((c) => c.lead_id === lead.id);
        if (here) return text(`${email} staat al als contact (${here.name}) bij **${lead.company_name}**. Niets toegevoegd.`);
        const elsewhere = (existing || []).filter((c) => c.lead_id !== lead.id);
        if (elsewhere.length && !a.toch_toevoegen) {
          return text(`**Niet toegevoegd:** ${email} staat al bij ${elsewhere.map((c) => `**${c.leads?.company_name || "?"}** (${c.name}, id ${c.lead_id})`).join(", ")}. Hoort deze persoon ook bij **${lead.company_name}**? Roep dan opnieuw aan met toch_toevoegen=true.`);
        }
      }

      const contact = await addContact({
        tenant, leadId: lead.id, name: a.name.trim(), email: email || null, phone: a.phone, role: a.role, isPrimary: a.is_primary === true,
      });
      await logActivity(lead.id, "contact_added", `Contact toegevoegd via Claude: ${contact.name}`);
      const newsletter = await applyNewsletterChoice(lead, email, a.nieuwsbrief === true, a.nieuwsbrief_reden?.trim());
      return text(`Contact **${contact.name}**${email ? ` (${email})` : ""} toegevoegd aan **${lead.company_name}** — ${newsletter}\n${ctx.origin}/leads/${lead.id}`);
    }
  );

  tool(
    "crm_set_newsletter",
    "write",
    "Zet de nieuwsbrief voor één e-mailadres aan of uit. Aanzetten vereist een toestemmingsgrond (reden). Staat het bedrijf nog uit, dan wordt het aangezet voor alleen dit adres; de andere adressen van dat bedrijf blijven uit. Een adres dat geblokkeerd is na een bounce of klacht kan alleen in het CRM worden gedeblokkeerd.",
    {
      email: z.string().min(3).describe("E-mailadres"),
      subscribed: z.boolean().describe("true = nieuwsbrief aan, false = uitschrijven"),
      reden: z.string().optional().describe("Verplicht bij aanzetten: de toestemmingsgrond. Bij uitschrijven optioneel, bijv. 'vroeg per mail om uitschrijving'."),
    },
    async ({ email, subscribed, reden }) => {
      const address = normalizeEmail(email);
      if (!address) return fail("Ongeldig e-mailadres.");
      if (subscribed && !reden?.trim()) return fail("Geef een reden (toestemmingsgrond) op om iemand in te schrijven.");

      if (!subscribed) {
        await setEmailSubscription({
          tenant, email: address, subscribed: false, userName: actor,
          reason: reden?.trim() ? `${reden.trim()} (via Claude, ${actor})` : null,
        });
        return text(`${address} is uitgeschreven voor de nieuwsbrief.`);
      }

      const [{ data: contactRows }, { data: leadRows }] = await Promise.all([
        supabase.from("contacts").select("lead_id").eq("tenant", tenant).ilike("email", escapeLikePattern(address)),
        supabase.from("leads").select("id").eq("tenant", tenant).ilike("email", escapeLikePattern(address)),
      ]);
      const ids = [...new Set([...(contactRows || []).map((r) => r.lead_id), ...(leadRows || []).map((r) => r.id)])];
      if (!ids.length) return text(`${address} staat nog niet in het CRM. Voeg het eerst toe met crm_create_relation of crm_add_contact.`);
      const { data: leads, error } = await supabase.from("leads")
        .select("id, company_name, email, marketing_consent, marketing_subscription_status, marketing_hard_bounced")
        .eq("tenant", tenant).in("id", ids);
      if (error) return fail(`Fout: ${error.message}`);

      const lines = [];
      for (const lead of leads || []) {
        lines.push(`**${lead.company_name}**: ${await applyNewsletterChoice(lead, address, true, reden.trim())}`);
      }
      return text(`${address}\n${lines.join("\n")}`);
    }
  );

  // --- Lead bijwerken ---
  tool(
    "crm_update_lead",
    "write",
    "Werk een lead (bedrijf) bij: contactgegevens, status, waarde. Status en waarde gelden voor het huidige traject; gebruik crm_update_opportunity voor een specifiek traject als een bedrijf er meerdere heeft.",
    {
      ...leadRef,
      status: z.string().optional().describe(`Nieuwe status. ${statusDesc}`),
      estimated_value: z.number().optional().describe("Geschatte waarde in euro"),
      email: z.string().optional().describe("E-mailadres"),
      phone: z.string().optional().describe("Telefoonnummer"),
      contact_function: z.string().optional().describe("Functie contactpersoon"),
      service_type: z.string().optional().describe("Service type"),
      source: z.string().optional().describe("Bron"),
      website_url: z.string().optional().describe("Website-URL"),
    },
    async ({ lead_id, company_name, ...updates }) => {
      const lead = await findLead({ lead_id, company_name });
      if (!lead) return text("Lead niet gevonden.");
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined && v !== ""));
      if (!Object.keys(clean).length) return text("Geen wijzigingen opgegeven.");
      if (WON_STATUSES.includes(clean.status)) clean.won_at = new Date().toISOString();
      const { data, error } = await supabase.from("leads").update(clean).eq("id", lead.id).eq("tenant", tenant).select().single();
      if (error) return fail(`Fout: ${error.message}`);
      return text(`Lead **${data.company_name}** bijgewerkt: ${Object.keys(clean).join(", ")}`);
    }
  );

  // --- Notitie ---
  tool(
    "crm_add_note",
    "write",
    "Voeg een notitie of to-do toe aan een lead. Notities staan op jouw naam.",
    {
      ...leadRef,
      content: z.string().min(1).describe("Inhoud van de notitie"),
      note_type: z.enum(["gesprek", "email", "intern", "inventarisatie", "todo"]).optional().describe("Type notitie (standaard: intern)"),
      due_date: z.string().optional().describe("Deadline als ISO-datum (alleen voor todo)"),
    },
    async ({ lead_id, company_name, content, note_type = "intern", due_date }) => {
      const lead = await findLead({ lead_id, company_name });
      if (!lead) return text("Lead niet gevonden.");
      const insert = { lead_id: lead.id, content, note_type, created_by: actor, user_id: user.id, tenant };
      if (note_type === "todo") {
        insert.is_completed = false;
        if (due_date) insert.due_date = due_date;
      }
      const { error } = await supabase.from("notes").insert(insert);
      if (error) return fail(`Fout: ${error.message}`);
      await logActivity(lead.id, "note_added", `Notitie toegevoegd (${note_type})`);
      return text(`Notitie (${note_type}) toegevoegd aan **${lead.company_name}**: "${content.substring(0, 80)}${content.length > 80 ? "..." : ""}"`);
    }
  );

  // --- To-do's ---
  tool(
    "crm_list_todos",
    "read",
    "Toon openstaande to-do's van je organisatie, gesorteerd op deadline. Standaard alleen je eigen; zet alle=true voor die van iedereen.",
    {
      alle: z.boolean().optional().describe("Ook to-do's van collega's tonen"),
      gebruiker: z.string().optional().describe("Alleen to-do's van deze collega (naam)"),
    },
    async ({ alle, gebruiker }) => {
      let q = supabase
        .from("notes")
        .select("id, content, due_date, created_by, user_id, lead_id, leads!inner(company_name, tenant)")
        .eq("note_type", "todo").eq("is_completed", false).eq("leads.tenant", tenant)
        .order("due_date", { ascending: true, nullsFirst: false }).limit(200);
      if (gebruiker) q = q.ilike("created_by", cleanTerm(gebruiker));
      else if (!alle) q = q.or(`user_id.eq.${user.id},created_by.eq."${actor.replace(/"/g, "")}"`);
      const { data, error } = await q;
      if (error) return fail(`Fout: ${error.message}`);
      if (!data?.length) return text("Geen openstaande to-do's.");
      const now = new Date();
      const lines = data.map((t) => {
        const overdue = t.due_date && new Date(t.due_date) < now;
        const due = t.due_date
          ? new Date(t.due_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
          : "geen deadline";
        return `${overdue ? "🔴" : "⬜"} **${t.content}** — ${t.leads?.company_name || "?"} — ${due}${t.created_by ? ` (${t.created_by})` : ""}`;
      });
      return text(`**${data.length} openstaande to-do's:**\n\n${lines.join("\n")}`);
    }
  );

  // --- Follow-ups ---
  tool(
    "crm_list_follow_ups",
    "read",
    "Toon openstaande follow-up taken (bijv. offerte nabellen) van je organisatie.",
    {},
    async () => {
      const { data, error } = await supabase
        .from("follow_up_tasks")
        .select("*, leads!inner(company_name, contact_person, tenant)")
        .eq("is_completed", false).eq("leads.tenant", tenant)
        .order("due_date", { ascending: true }).limit(200);
      if (error) return fail(`Fout: ${error.message}`);
      if (!data?.length) return text("Geen openstaande follow-ups.");
      const lines = data.map((t) => {
        const due = new Date(t.due_date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
        return `• **${t.description}** — ${t.leads?.company_name || "?"} — ${due} — type: ${t.task_type}`;
      });
      return text(`**${data.length} openstaande follow-ups:**\n\n${lines.join("\n")}`);
    }
  );

  // --- Pipeline ---
  tool(
    "crm_pipeline_metrics",
    "search",
    "Toon pipelinestatistieken van je organisatie, geteld per traject: actieve waarde, gewonnen, verloren, win rate en uitsplitsing per service type.",
    {},
    async () => {
      const deals = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("opportunities").select("id, status, service_type, estimated_value, leads(in_pipeline)")
          .eq("tenant", tenant).order("id").range(from, from + 999);
        if (error) return fail(`Fout: ${error.message}`);
        deals.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      if (!deals.length) return text("Geen data beschikbaar.");

      const closed = [...WON_STATUSES, ...LOST_STATUSES];
      const sum = (list) => list.reduce((s, l) => s + (parseFloat(l.estimated_value) || 0), 0);
      const active = deals.filter((l) => l.leads?.in_pipeline !== false && !closed.includes(l.status));
      const won = deals.filter((l) => WON_STATUSES.includes(l.status));
      const lost = deals.filter((l) => LOST_STATUSES.includes(l.status));
      const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

      let t = `# Pipeline ${ctx.orgName}\n\n`;
      t += `• **Actieve trajecten:** ${active.length} (€${sum(active).toLocaleString("nl-NL")})\n`;
      t += `• **Gewonnen:** ${won.length} (€${sum(won).toLocaleString("nl-NL")})\n`;
      t += `• **Verloren:** ${lost.length}\n`;
      t += `• **Win rate:** ${winRate}%\n`;
      t += `• **Totaal trajecten:** ${deals.length}\n`;

      const byType = {};
      deals.forEach((l) => {
        const k = l.service_type || "onbekend";
        byType[k] ||= { total: 0, won: 0, lost: 0, value: 0 };
        byType[k].total++;
        if (WON_STATUSES.includes(l.status)) byType[k].won++;
        if (LOST_STATUSES.includes(l.status)) byType[k].lost++;
        byType[k].value += parseFloat(l.estimated_value) || 0;
      });
      t += `\n## Per service type\n`;
      Object.entries(byType).forEach(([k, d]) => {
        const wr = d.won + d.lost > 0 ? Math.round((d.won / (d.won + d.lost)) * 100) : "-";
        t += `• **${k}**: ${d.total} trajecten — €${d.value.toLocaleString("nl-NL")} — win rate: ${wr}%\n`;
      });
      return text(t);
    }
  );

  // --- Trajecten ---
  tool(
    "crm_create_opportunity",
    "write",
    "Start een nieuw traject (deal) bij een bestaand bedrijf. Gebruik dit voor een nieuwe kans bij een bestaande klant in plaats van een tweede lead.",
    {
      ...leadRef,
      name: z.string().min(1).describe("Naam van het traject, bijv. 'Vacatureautomatisering'"),
      status: z.string().optional().describe(`Status (standaard de eerste fase). ${statusDesc}`),
      service_type: z.string().optional().describe("Service type"),
      estimated_value: z.number().optional().describe("Geschatte waarde in euro"),
    },
    async ({ lead_id, company_name, name, status, service_type, estimated_value }) => {
      const lead = await findLead({ lead_id, company_name });
      if (!lead) return text("Lead niet gevonden.");
      const { data, error } = await supabase.from("opportunities").insert({
        tenant, lead_id: lead.id, name, status: status || (tenant === "hiphot" ? "nieuwe_aanvraag" : "nieuw"),
        service_type: service_type || null, estimated_value: estimated_value ?? null,
      }).select().single();
      if (error) return fail(`Fout: ${error.message}`);
      await logActivity(lead.id, "opportunity_created", `Nieuw traject: ${name}`, { opportunity_id: data.id });
      return text(`Traject aangemaakt bij **${lead.company_name}**: **${name}** (${data.id}) — status ${data.status}`);
    }
  );

  tool(
    "crm_update_opportunity",
    "write",
    "Werk een traject (deal) bij: status, naam, waarde of reden gewonnen/verloren. Het bedrijf volgt automatisch als dit het huidige traject is.",
    {
      opportunity_id: z.string().describe("UUID van het traject (zie crm_get_lead)"),
      name: z.string().optional().describe("Nieuwe naam"),
      status: z.string().optional().describe(`Nieuwe status. ${statusDesc}`),
      estimated_value: z.number().optional().describe("Geschatte waarde in euro"),
      service_type: z.string().optional().describe("Service type"),
      win_reason: z.string().optional().describe("Reden gewonnen"),
      lost_reason: z.string().optional().describe("Reden verloren"),
    },
    async ({ opportunity_id, ...updates }) => {
      if (!UUID_RE.test(opportunity_id)) return text("Traject niet gevonden.");
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined && v !== ""));
      if (!Object.keys(clean).length) return text("Geen wijzigingen opgegeven.");
      const { data, error } = await supabase
        .from("opportunities").update(clean).eq("id", opportunity_id).eq("tenant", tenant).select().maybeSingle();
      if (error) return fail(`Fout: ${error.message}`);
      if (!data) return text("Traject niet gevonden.");
      return text(`Traject **${data.name}** bijgewerkt: ${Object.keys(clean).join(", ")} (status nu ${data.status})`);
    }
  );

  // --- Offertes ---
  tool(
    "crm_create_quote",
    "write",
    "Maak een conceptofferte aan voor een lead. De offerte komt bij het huidige traject, of bij het opgegeven traject. Opmaak en versturen gaan via het CRM.",
    {
      ...leadRef,
      opportunity_id: z.string().optional().describe("UUID van het traject (standaard het huidige traject van het bedrijf)"),
      amount: z.number().describe("Bedrag excl. btw"),
      description: z.string().optional().describe("Omschrijving van de offerte"),
      vat_percentage: z.number().optional().describe("Btw-percentage (standaard 21)"),
    },
    async ({ lead_id, company_name, opportunity_id, amount, description, vat_percentage = 21 }) => {
      const lead = await findLead({ lead_id, company_name });
      if (!lead) return text("Lead niet gevonden.");

      let oppId = null;
      if (opportunity_id) {
        if (!UUID_RE.test(opportunity_id)) return text("Traject hoort niet bij deze lead.");
        const { data: opp } = await supabase
          .from("opportunities").select("id").eq("id", opportunity_id).eq("lead_id", lead.id).eq("tenant", tenant).maybeSingle();
        if (!opp) return text("Traject hoort niet bij deze lead.");
        oppId = opp.id;
      } else {
        const { data: current } = await supabase.rpc("current_opportunity_id", { p_lead_id: lead.id });
        oppId = current || null;
      }

      const { data: qNum } = await supabase.rpc("generate_quote_number");
      const quoteNumber = qNum || `OFT-${Date.now()}`;
      const { data, error } = await supabase.from("quotes").insert({
        lead_id: lead.id, opportunity_id: oppId, quote_number: quoteNumber, amount_excl_vat: amount,
        vat_percentage, description: description || null, status: "concept", created_by: actor, tenant,
      }).select().single();
      if (error) return fail(`Fout: ${error.message}`);

      await updateOpportunityValue(oppId);
      await logActivity(lead.id, "quote_created", `Offerte ${quoteNumber} aangemaakt (€${amount} excl. btw)`, { quote_id: data.id });
      return text(`Offerte aangemaakt voor **${lead.company_name}**: **${quoteNumber}** — €${amount} excl. btw${description ? ` — ${description}` : ""}\nStatus: concept\n${ctx.origin}/leads/${lead.id}`);
    }
  );

  tool(
    "crm_list_quotes",
    "read",
    "Toon offertes van je organisatie met filters. Gebruik dit voor 'openstaande offertes' of 'offertes die bijna verlopen'. Zonder status: alle openstaande (concept + verstuurd).",
    {
      ...leadRef,
      status: z.enum(["concept", "verstuurd", "geaccepteerd", "afgewezen", "verlopen"]).optional().describe("Filter op offertestatus"),
      expiring_within_days: z.number().optional().describe("Alleen offertes die binnen N dagen verlopen"),
      limit: z.number().optional().describe("Max aantal resultaten (standaard 50, max 200)"),
    },
    async ({ lead_id, company_name, status, expiring_within_days, limit }) => {
      let leadFilter = null;
      if (lead_id || company_name) {
        const lead = await findLead({ lead_id, company_name });
        if (!lead) return text("Lead niet gevonden.");
        leadFilter = lead.id;
      }
      let q = supabase
        .from("quotes")
        .select("id, quote_number, amount_excl_vat, description, status, valid_until, lead_id, leads(company_name), opportunities(name)")
        .eq("tenant", tenant).order("created_at", { ascending: false }).limit(Math.min(limit || 50, 200));
      if (leadFilter) q = q.eq("lead_id", leadFilter);
      q = status ? q.eq("status", status) : q.in("status", ["concept", "verstuurd"]);
      if (expiring_within_days != null) {
        const today = new Date();
        const future = new Date(today.getTime() + expiring_within_days * 86400000);
        q = q.gte("valid_until", today.toISOString().slice(0, 10)).lte("valid_until", future.toISOString().slice(0, 10));
      }
      const { data, error } = await q;
      if (error) return fail(`Fout: ${error.message}`);
      if (!data?.length) return text("Geen offertes gevonden met deze filters.");
      const today = new Date();
      const lines = data.map((qu) => {
        const days = qu.valid_until ? Math.ceil((new Date(qu.valid_until) - today) / 86400000) : null;
        const expiry = days == null ? "geen vervaldatum"
          : days < 0 ? `🔴 ${Math.abs(days)}d verlopen`
          : days <= 7 ? `⚠️ verloopt over ${days}d` : `geldig tot ${qu.valid_until}`;
        const desc = qu.description ? `\n  ${qu.description.slice(0, 100)}${qu.description.length > 100 ? "..." : ""}` : "";
        return `• **${qu.quote_number}** — ${qu.leads?.company_name || "?"}${qu.opportunities?.name ? ` (traject: ${qu.opportunities.name})` : ""} — €${qu.amount_excl_vat} excl. — ${qu.status} — ${expiry}${desc}`;
      });
      return text(`**${data.length} offertes:**\n\n${lines.join("\n")}`);
    }
  );

  // --- Bijlage ---
  tool(
    "crm_add_attachment",
    "write",
    "Voeg een bestand (PDF, afbeelding, Office-document, enz.) als bijlage toe aan een lead. Stuur de inhoud als base64 mee; maximaal 3 MB.",
    {
      ...leadRef,
      file_content: z.string().describe("Base64-gecodeerde bestandsinhoud"),
      filename: z.string().min(1).describe("Bestandsnaam inclusief extensie"),
      description: z.string().optional().describe("Beschrijving van het bestand"),
    },
    async ({ lead_id, company_name, file_content, filename, description }) => {
      const lead = await findLead({ lead_id, company_name });
      if (!lead) return text("Lead niet gevonden.");
      const buffer = Buffer.from(file_content.replace(/^data:[^;]+;base64,/, ""), "base64");
      if (!buffer.length) return fail("Lege of ongeldige base64-inhoud.");
      if (buffer.length > MAX_ATTACHMENT_BYTES) return fail("Bestand is groter dan 3 MB. Upload het via het CRM zelf.");

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
      const ext = safeName.split(".").pop()?.toLowerCase() || "";
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      const storagePath = `${lead.id}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("attachments").upload(storagePath, buffer, { contentType: mimeType, upsert: false });
      if (uploadError) return fail(`Upload mislukt: ${uploadError.message}`);

      const { data, error } = await supabase.from("attachments").insert({
        lead_id: lead.id, file_name: filename, file_type: mimeType, file_size: buffer.length,
        storage_path: storagePath, uploaded_by: actor, description: description || null, tenant,
      }).select().single();
      if (error) return fail(`Databasefout: ${error.message}`);

      await logActivity(lead.id, "attachment_added", `Bijlage toegevoegd: ${filename}${description ? ` (${description})` : ""}`, { attachment_id: data.id, file_name: filename });
      return text(`Bijlage toegevoegd aan **${lead.company_name}**: **${filename}** (${Math.round(buffer.length / 1024)} KB)\n${ctx.origin}/leads/${lead.id}`);
    }
  );

  // --- Inbox ---
  tool(
    "crm_check_inbox",
    "expensive",
    "Controleer de leads-inbox van je organisatie op nieuwe e-mails en verwerk ze tot leads (zelfde als de knop in het CRM).",
    {},
    async () => {
      // Hergebruikt /api/poll-inbox met een kortlevende sessie van deze
      // gebruiker: die route pollt bij een gebruikerssessie alleen de mailbox
      // van diens eigen tenant.
      const cookie = await signToken({
        user_id: user.id, name: user.name, email: user.email, role: user.role, tenant, org_id: user.organization_id,
      });
      const res = await fetch(`${ctx.origin}/api/poll-inbox`, {
        headers: { Cookie: `crm-auth=${cookie}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return fail(`Fout: ${data.error || res.status}${data.detail ? ` — ${data.detail}` : ""}`);
      const results = (data.mailboxes || []).flatMap((m) => m.results || []);
      return text(`Inbox gecheckt: **${data.processed ?? 0}** e-mails verwerkt.${results.length ? "\n" + results.map((r) => `• ${r.email_subject} → ${r.status}`).join("\n") : ""}`);
    }
  );
}
