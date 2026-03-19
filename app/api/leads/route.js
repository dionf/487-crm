import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const service_type = searchParams.get("service_type");
  const search = searchParams.get("search");
  const sort = searchParams.get("sort") || "created_at";
  const order = searchParams.get("order") || "desc";

  let query = supabase
    .from("leads")
    .select("*, quotes(id), notes(id, is_completed, note_type)")
    .order(sort, { ascending: order === "asc" });

  if (status) query = query.eq("status", status);
  if (service_type) query = query.eq("service_type", service_type);
  if (search) {
    query = query.or(
      `company_name.ilike.%${search}%,contact_person.ilike.%${search}%`
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
  const body = await request.json();
  const { company_name, contact_person, email, phone, service_type, estimated_value, source, website_url } = body;

  if (!company_name || !contact_person || !email) {
    return Response.json(
      { error: "company_name, contact_person en email zijn verplicht" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      company_name,
      contact_person,
      email,
      phone: phone || null,
      service_type: service_type || null,
      estimated_value: estimated_value || null,
      source: source || null,
      website_url: website_url || null,
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
  });

  return Response.json({ lead: data }, { status: 201 });
}
