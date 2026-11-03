import { supabaseAdmin } from "@/lib/supabase-admin";

// Tenants waar contacts de bron van waarheid is voor contactpersonen.
// hiphot volgt later (veel generieke info@-adressen zonder naam, zie migratie 032).
const PRIMARY_CONTACT_TENANTS = new Set(["48-7"]);

const PLACEHOLDER_NAMES = new Set(["", "-", "onbekend"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Maakt een primair contact aan op basis van de contactvelden van een lead,
// als die lead nog geen enkel contact heeft. Fouten worden gelogd en niet
// gegooid: het aanmaken van de lead zelf mag hier nooit op stuklopen.
export async function ensurePrimaryContactForLead(leadId, tenant) {
  if (!leadId || !PRIMARY_CONTACT_TENANTS.has(tenant)) return null;

  try {
    const { count } = await supabaseAdmin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("tenant", tenant);
    if (count > 0) return null;

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, contact_person, contact_first_name, contact_last_name, contact_function, email, phone")
      .eq("id", leadId)
      .eq("tenant", tenant)
      .single();
    if (!lead) return null;

    const email = clean(lead.email).toLowerCase();
    let name = clean(lead.contact_person);
    if (PLACEHOLDER_NAMES.has(name.toLowerCase())) {
      name = [clean(lead.contact_first_name), clean(lead.contact_last_name)].filter(Boolean).join(" ");
    }
    if (PLACEHOLDER_NAMES.has(name.toLowerCase())) name = email;
    if (!name) return null;

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .insert({
        lead_id: lead.id,
        tenant,
        name,
        email: email || null,
        phone: clean(lead.phone) || null,
        role: clean(lead.contact_function) || null,
        is_primary: true,
        marketing_consent: false,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error("ensurePrimaryContactForLead mislukt:", leadId, err?.message || err);
    return null;
  }
}

// Zet de contactvelden van de lead gelijk aan het primaire contact. Een leeg
// e-mailadres of telefoonnummer laat dat van de lead staan: het algemene adres
// van het bedrijf mag niet verdwijnen omdat het contact er geen heeft.
async function syncPrimaryToLead(contact, tenant) {
  const name = contact.name || "";
  const nameParts = name.split(" ");
  const { error } = await supabaseAdmin
    .from("leads")
    .update({
      contact_person: name,
      contact_first_name: nameParts[0] || "",
      contact_last_name: nameParts.slice(1).join(" ") || "",
      contact_function: contact.role || null,
      email: contact.email || undefined,
      phone: contact.phone || undefined,
    })
    .eq("id", contact.lead_id)
    .eq("tenant", tenant);
  if (error) console.error("syncPrimaryToLead mislukt:", contact.lead_id, error.message);
}

// Voegt een contact toe aan een bedrijf. Bij is_primary worden de andere
// contacten niet-primair en volgen de contactvelden van de lead. Gedeeld door
// POST /api/contacts en de Claude-connector (lib/mcp/tools.js).
export async function addContact({ tenant, leadId, name, email, phone, role, isPrimary = false, marketingConsent = false }) {
  if (isPrimary) {
    await supabaseAdmin
      .from("contacts")
      .update({ is_primary: false })
      .eq("lead_id", leadId)
      .eq("tenant", tenant);
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      lead_id: leadId,
      name,
      email: email || null,
      phone: phone || null,
      role: role || null,
      is_primary: isPrimary || false,
      tenant,
      marketing_consent: marketingConsent || false,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (data.is_primary) await syncPrimaryToLead(data, tenant);
  return data;
}

// Velden die via bijwerken aangepast mogen worden.
const CONTACT_UPDATE_FIELDS = new Set(["name", "email", "phone", "role", "is_primary", "marketing_consent"]);

// Een uitschrijving, bounce of "geen toestemming" hangt aan het adres. Krijgt
// een contact een nieuw adres, dan gaat die blokkade mee, zodat iemand die
// zich afmeldde niet via een adreswijziging weer de nieuwsbrief krijgt.
async function carryOverSuppression(tenant, oldEmail, newEmail) {
  const from = clean(oldEmail).toLowerCase();
  const to = clean(newEmail).toLowerCase();
  if (!from || !to || from === to) return;
  const { data: rows } = await supabaseAdmin
    .from("newsletter_email_suppressions")
    .select("email, status, source, reason")
    .eq("tenant", tenant)
    .in("email", [from, to]);
  const old = (rows || []).find((r) => r.email === from);
  if (!old || (rows || []).some((r) => r.email === to)) return;
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("newsletter_email_suppressions").insert({
    tenant,
    email: to,
    status: old.status,
    source: old.source || "manual",
    reason: `overgenomen van ${from}${old.reason ? `: ${old.reason}` : ""}`,
    suppressed_at: now,
    updated_at: now,
  });
  if (error) console.error("carryOverSuppression mislukt:", to, error.message);
}

// Werkt een contact bij binnen de tenant. Wordt het contact primair, dan
// worden de andere contacten daarna niet-primair; is het contact primair, dan
// volgen de contactvelden van de lead. Geeft null als het contact niet
// bestaat. Gedeeld door PATCH /api/contacts/[id] en de Claude-connector.
export async function updateContact({ tenant, contactId, updates }) {
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("tenant, lead_id, email").eq("id", contactId).maybeSingle();
  if (!existing || existing.tenant !== tenant) return null;

  const row = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(updates || {})) {
    if (CONTACT_UPDATE_FIELDS.has(key)) row[key] = value;
  }

  // Eerst het contact zelf: mislukt dat, dan is er nog niets veranderd.
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .update(row)
    .eq("id", contactId)
    .eq("tenant", tenant)
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (row.is_primary) {
    await supabaseAdmin
      .from("contacts")
      .update({ is_primary: false })
      .eq("lead_id", existing.lead_id)
      .eq("tenant", tenant)
      .neq("id", contactId);
  }
  if ("email" in row) await carryOverSuppression(tenant, existing.email, data.email);
  if (data.is_primary) await syncPrimaryToLead(data, tenant);
  return data;
}

// Verwijdert een contact binnen de tenant. Was het het primaire contact, dan
// wordt het oudste overgebleven contact primair en volgt de lead dat contact.
// Geeft het verwijderde contact terug (met promoted: het nieuwe primaire
// contact of null), of null als het contact niet bestaat. Het verwijderen
// zelf is dan gelukt; een mislukte promotie wordt gelogd, niet gegooid.
export async function deleteContact({ tenant, contactId }) {
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!existing || existing.tenant !== tenant) return null;

  const { error } = await supabaseAdmin.from("contacts").delete().eq("id", contactId).eq("tenant", tenant);
  if (error) throw new Error(error.message);

  let promoted = null;
  if (existing.is_primary) {
    try {
      const { data: next } = await supabaseAdmin
        .from("contacts").select("id")
        .eq("lead_id", existing.lead_id).eq("tenant", tenant)
        .order("created_at", { ascending: true }).limit(1);
      if (next?.[0]) promoted = await updateContact({ tenant, contactId: next[0].id, updates: { is_primary: true } });
    } catch (err) {
      console.error("deleteContact: nieuw primair contact zetten mislukt:", existing.lead_id, err?.message || err);
    }
  }
  return { ...existing, promoted };
}
