import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("hiphot_settings")
    .select("*")
    .eq("tenant", "hiphot")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ settings: data });
}

export async function PATCH(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");

  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }
  if (role !== "admin") {
    return Response.json({ error: "Admin-only functie" }, { status: 403 });
  }

  const body = await request.json();
  const numericKeys = ["verzendkosten", "gratis_drempel", "pickpack_vast", "pickpack_per_artikel"];
  const jsonKeys = ["intro_html", "terms_html"];
  const updates = { updated_at: new Date().toISOString() };

  for (const key of numericKeys) {
    if (body[key] !== undefined) updates[key] = Number(body[key]);
  }
  for (const key of jsonKeys) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const { data, error } = await supabase
    .from("hiphot_settings")
    .update(updates)
    .eq("tenant", "hiphot")
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ settings: data });
}
