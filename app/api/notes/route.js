import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lead_id = searchParams.get("lead_id");

  let query = supabase
    .from("notes")
    .select("*")
    .order("created_at", { ascending: false });

  if (lead_id) query = query.eq("lead_id", lead_id);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ notes: data });
}

export async function POST(request) {
  const body = await request.json();
  const { lead_id, content, note_type, created_by, due_date } = body;

  if (!lead_id || !content) {
    return Response.json(
      { error: "lead_id en content zijn verplicht" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("notes")
    .insert({
      lead_id,
      content,
      note_type: note_type || "intern",
      created_by: created_by || null,
      due_date: due_date || null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await supabase.from("activities").insert({
    lead_id,
    activity_type: "note_added",
    description: `Notitie toegevoegd (${note_type || "intern"})`,
    metadata: { note_id: data.id, note_type: note_type || "intern" },
    created_by: created_by || null,
  });

  return Response.json({ note: data }, { status: 201 });
}
