import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const quote_id = searchParams.get("quote_id");
  const lead_id = searchParams.get("lead_id");

  let query = supabase
    .from("attachments")
    .select("*")
    .order("created_at", { ascending: false });

  if (quote_id) query = query.eq("quote_id", quote_id);
  if (lead_id) query = query.eq("lead_id", lead_id);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ attachments: data });
}

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const quote_id = formData.get("quote_id");
  const lead_id = formData.get("lead_id");
  const uploaded_by = formData.get("uploaded_by") || "Dion";

  if (!file || !lead_id) {
    return Response.json(
      { error: "file en lead_id zijn verplicht" },
      { status: 400 }
    );
  }

  // Create unique storage path
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${lead_id}/${timestamp}_${safeName}`;

  // Upload to Supabase Storage
  const buffer = Buffer.from(await file.arrayBuffer());
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  // Save record in attachments table
  const { data, error } = await supabase
    .from("attachments")
    .insert({
      quote_id: quote_id || null,
      lead_id,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      storage_path: storagePath,
      uploaded_by,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await supabase.from("activities").insert({
    lead_id,
    activity_type: "attachment_added",
    description: `Bijlage toegevoegd: ${file.name}${quote_id ? " (bij offerte)" : ""}`,
    metadata: { attachment_id: data.id, file_name: file.name, quote_id },
    created_by: uploaded_by,
  });

  return Response.json({ attachment: data }, { status: 201 });
}
