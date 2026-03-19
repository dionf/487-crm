import { supabase } from "@/lib/supabase";

export async function GET(request, { params }) {
  const { id } = params;

  const { data, error } = await supabase
    .from("quotes")
    .select("*, leads(company_name, contact_person, email)")
    .eq("id", id)
    .single();

  if (error) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  return Response.json({ quote: data });
}

export async function PATCH(request, { params }) {
  const { id } = params;
  const body = await request.json();

  if (body.status === "verstuurd" && !body.sent_at) {
    body.sent_at = new Date().toISOString();
  }
  if (body.status === "geaccepteerd" && !body.accepted_at) {
    body.accepted_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("quotes")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ quote: data });
}

export async function DELETE(request, { params }) {
  const { id } = params;
  const { error } = await supabase.from("quotes").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
