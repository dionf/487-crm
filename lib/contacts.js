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
