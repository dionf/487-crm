import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = await params;

  const { data, error } = await supabase
    .from("form_submissions")
    .select("*")
    .eq("id", id)
    .eq("tenant", tenant)
    .single();

  if (error || !data) {
    return Response.json({ error: "Niet gevonden" }, { status: 404 });
  }

  return Response.json({ submission: data });
}

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = await params;
  const body = await request.json();

  // Prevent status downgrade: gelezen can't overwrite beantwoord/gearchiveerd
  if (body.status === "gelezen") {
    const { data: current } = await supabase
      .from("form_submissions")
      .select("status")
      .eq("id", id)
      .eq("tenant", tenant)
      .single();

    if (current && ["beantwoord", "gearchiveerd"].includes(current.status)) {
      return Response.json({ submission: current });
    }
  }

  const updates = {};
  if (body.status) updates.status = body.status;
  if (body.lead_id) updates.lead_id = body.lead_id;

  const { data, error } = await supabase
    .from("form_submissions")
    .update(updates)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ submission: data });
}
