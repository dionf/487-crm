import { supabase } from "@/lib/supabase";

export async function GET(request, { params }) {
  const { id } = params;

  // Get attachment record
  const { data: attachment, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !attachment) {
    return Response.json({ error: "Bijlage niet gevonden" }, { status: 404 });
  }

  // Generate signed URL (valid for 1 hour)
  const { data: signedData, error: signError } = await supabase.storage
    .from("attachments")
    .createSignedUrl(attachment.storage_path, 3600);

  if (signError) {
    return Response.json({ error: signError.message }, { status: 500 });
  }

  return Response.json({
    attachment,
    download_url: signedData.signedUrl,
  });
}

export async function DELETE(request, { params }) {
  const { id } = params;

  // Get attachment to find storage path
  const { data: attachment } = await supabase
    .from("attachments")
    .select("*")
    .eq("id", id)
    .single();

  if (attachment) {
    // Delete from storage
    await supabase.storage
      .from("attachments")
      .remove([attachment.storage_path]);
  }

  // Delete record
  const { error } = await supabase.from("attachments").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
