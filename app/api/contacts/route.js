import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get("lead_id");
  const marketingOnly = searchParams.get("marketing") === "true";
  const tenant = request.headers.get("x-auth-tenant");

  let q = supabase
    .from("contacts")
    .select("*, leads(company_name)")
    .eq("tenant", tenant)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });

  if (leadId) q = q.eq("lead_id", leadId);
  if (marketingOnly) q = q.eq("marketing_consent", true);

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ contacts: data });
}

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();

  const { lead_id, name, email, phone, role, is_primary, marketing_consent } = body;
  if (!lead_id || !name) {
    return Response.json({ error: "lead_id en name zijn verplicht" }, { status: 400 });
  }

  // If setting as primary, unset other primaries for this lead
  if (is_primary) {
    await supabase
      .from("contacts")
      .update({ is_primary: false })
      .eq("lead_id", lead_id);
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      lead_id,
      name,
      email: email || null,
      phone: phone || null,
      role: role || null,
      is_primary: is_primary || false,
      marketing_consent: marketing_consent || false,
      tenant,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Update lead's primary contact fields if this is primary
  if (is_primary || data.is_primary) {
    const nameParts = name.split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    await supabase
      .from("leads")
      .update({
        contact_person: name,
        contact_first_name: firstName,
        contact_last_name: lastName,
        email: email || undefined,
        phone: phone || undefined,
      })
      .eq("id", lead_id);
  }

  return Response.json({ contact: data });
}
