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

  if (isPrimary || data.is_primary) {
    const nameParts = name.split(" ");
    await supabaseAdmin
      .from("leads")
      .update({
        contact_person: name,
        contact_first_name: nameParts[0] || "",
        contact_last_name: nameParts.slice(1).join(" ") || "",
        email: email || undefined,
        phone: phone || undefined,
      })
      .eq("id", leadId)
      .eq("tenant", tenant);
  }
  return data;
}

// Zet de contactvelden van de lead gelijk aan het primaire contact.
async function syncPrimaryToLead(contact, tenant) {
  const nameParts = (contact.name || "").split(" ");
  await supabaseAdmin
    .from("leads")
    .update({
      contact_person: contact.name,
      contact_first_name: nameParts[0] || "",
      contact_last_name: nameParts.slice(1).join(" ") || "",
      contact_function: contact.role ?? undefined,
      email: contact.email,
      phone: contact.phone,
    })
    .eq("id", contact.lead_id)
    .eq("tenant", tenant);
}

const CONTACT_UPDATE_BLOCKED = new Set(["id", "tenant", "lead_id", "created_at"]);

// Werkt een contact bij binnen de tenant. Bij is_primary worden de andere
// contacten niet-primair; is het contact (daarna) primair, dan volgen de
// contactvelden van de lead. Geeft null als het contact niet bestaat.
// Gedeeld door PATCH /api/contacts/[id] en de Claude-connector.
export async function updateContact({ tenant, contactId, updates }) {
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("tenant, lead_id").eq("id", contactId).maybeSingle();
  if (!existing || existing.tenant !== tenant) return null;

  if (updates.is_primary) {
    await supabaseAdmin
      .from("contacts")
      .update({ is_primary: false })
      .eq("lead_id", existing.lead_id)
      .eq("tenant", tenant);
  }

  const row = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(updates)) {
    if (!CONTACT_UPDATE_BLOCKED.has(key)) row[key] = value;
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .update(row)
    .eq("id", contactId)
    .eq("tenant", tenant)
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (data.is_primary) await syncPrimaryToLead(data, tenant);
  return data;
}

// Verwijdert een contact binnen de tenant. Was het het primaire contact, dan
// wordt het oudste overgebleven contact primair en volgt de lead dat contact.
// Geeft het verwijderde contact terug (met promoted: het nieuwe primaire
// contact of null), of null als het contact niet bestaat.
export async function deleteContact({ tenant, contactId }) {
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!existing || existing.tenant !== tenant) return null;

  const { error } = await supabaseAdmin.from("contacts").delete().eq("id", contactId).eq("tenant", tenant);
  if (error) throw new Error(error.message);

  let promoted = null;
  if (existing.is_primary) {
    const { data: next } = await supabaseAdmin
      .from("contacts").select("id")
      .eq("lead_id", existing.lead_id).eq("tenant", tenant)
      .order("created_at", { ascending: true }).limit(1);
    if (next?.[0]) promoted = await updateContact({ tenant, contactId: next[0].id, updates: { is_primary: true } });
  }
  return { ...existing, promoted };
}
