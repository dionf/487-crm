import { supabase } from "@/lib/supabase";

export async function PATCH(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const { data, error } = await supabase
    .from("notes")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ note: data });
}

export async function DELETE(request, { params }) {
  const { id } = params;
  const { error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
