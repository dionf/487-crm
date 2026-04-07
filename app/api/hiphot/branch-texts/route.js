import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const branch_key = searchParams.get("branch_key");
  const language = searchParams.get("language");

  let query = supabase
    .from("quote_branch_texts")
    .select("*")
    .eq("tenant", "hiphot")
    .order("branch_key")
    .order("language");

  if (branch_key) query = query.eq("branch_key", branch_key);
  if (language) query = query.eq("language", language);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ texts: data });
}

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const body = await request.json();
  const { branch_key, language, title, body: textBody } = body;

  if (!branch_key || !language) {
    return Response.json(
      { error: "branch_key en language zijn verplicht" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("quote_branch_texts")
    .insert({
      tenant: "hiphot",
      branch_key,
      language: language || "nl",
      title: title || null,
      body: textBody || null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ text: data }, { status: 201 });
}
