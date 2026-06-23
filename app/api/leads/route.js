import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const service_type = searchParams.get("service_type");
  const search = searchParams.get("search");
  const sort = searchParams.get("sort") || "created_at";
  const order = searchParams.get("order") || "desc";
  const assigned_to = searchParams.get("assigned_to");
  const call_filter = searchParams.get("call_filter");

  let query = supabase
    .from("leads")
    .select("*, quotes(id), notes(id, is_completed, note_type)")
    .eq("tenant", tenant)
    .order(sort, { ascending: order === "asc" });

  if (status) query = query.eq("status", status);
  if (service_type) query = query.eq("service_type", service_type);
  if (assigned_to) query = query.eq("assigned_to", assigned_to);

  // HipHot bellijst filters
  if (call_filter === "nieuw") {
    query = query.is("call_outcome", null).is("last_called_at", null);
  } else if (call_filter === "terugbellen") {
    query = query.eq("call_outcome", "terugbellen_5_dagen");
  } else if (call_filter === "geen_gehoor") {
    query = query.eq("call_outcome", "geen_gehoor_terugbellen");
  }
  if (search) {
    query = query.or(
      `company_name.ilike.%${search}%,contact_person.ilike.%${search}%,contact_first_name.ilike.%${search}%,contact_last_name.ilike.%${search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const leads = data.map((lead) => ({
    ...lead,
    quote_count: lead.quotes?.length || 0,
    note_count: lead.notes?.length || 0,
    open_todo_count:
      lead.notes?.filter((n) => n.note_type === "todo" && !n.is_completed)
        .length || 0,
    quotes: undefined,
    notes: undefined,
  }));

  return Response.json({ leads, total: leads.length });
}

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();
  const {
    company_name, contact_first_name, contact_last_name, contact_function, contact_person,
    email, phone, service_type, estimated_value, source, website_url, commission_partner_percentage,
    industry,
    // Adressen & facturatie
    billing_street, billing_house_number, billing_postal_code, billing_city, billing_country,
    billing_email, customer_reference,
    delivery_same_as_billing,
    delivery_street, delivery_house_number, delivery_postal_code, delivery_city, delivery_country,
  } = body;

  // Support both new fields and legacy contact_person
  const firstName = contact_first_name || (contact_person ? contact_person.split(" ")[0] : "");
  const lastName = contact_last_name || (contact_person ? contact_person.split(" ").slice(1).join(" ") : "");
  const fullName = `${firstName} ${lastName}`.trim();

  if (!company_name || !fullName || !email) {
    return Response.json(
      { error: "company_name, voornaam/achternaam en email zijn verplicht" },
      { status: 400 }
    );
  }

  const defaultStatus = tenant === "hiphot" ? "nieuwe_aanvraag" : "nieuw";

  // Als 'leveradres = factuuradres', kopieer billing → delivery server-side
  const useSame = delivery_same_as_billing !== false;
  const deliveryFields = useSame
    ? {
        delivery_same_as_billing: true,
        delivery_street: billing_street || null,
        delivery_house_number: billing_house_number || null,
        delivery_postal_code: billing_postal_code || null,
        delivery_city: billing_city || null,
        delivery_country: billing_country || "NL",
      }
    : {
        delivery_same_as_billing: false,
        delivery_street: delivery_street || null,
        delivery_house_number: delivery_house_number || null,
        delivery_postal_code: delivery_postal_code || null,
        delivery_city: delivery_city || null,
        delivery_country: delivery_country || "NL",
      };

  const { data, error } = await supabase
    .from("leads")
    .insert({
      company_name,
      contact_first_name: firstName,
      contact_last_name: lastName,
      contact_function: contact_function || null,
      contact_person: fullName,
      email,
      phone: phone || null,
      service_type: service_type || null,
      estimated_value: estimated_value || null,
      source: source || null,
      website_url: website_url || null,
      commission_partner_percentage: commission_partner_percentage || null,
      industry: industry || null,
      status: defaultStatus,
      tenant,
      billing_street: billing_street || null,
      billing_house_number: billing_house_number || null,
      billing_postal_code: billing_postal_code || null,
      billing_city: billing_city || null,
      billing_country: billing_country || "NL",
      billing_email: billing_email || null,
      customer_reference: customer_reference || null,
      ...deliveryFields,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await supabase.from("activities").insert({
    lead_id: data.id,
    activity_type: "lead_created",
    description: `Lead aangemaakt: ${company_name}`,
    created_by: body.created_by || null,
    tenant,
  });

  return Response.json({ lead: data }, { status: 201 });
}
