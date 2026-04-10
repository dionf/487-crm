import { supabase } from "@/lib/supabase";

export async function GET(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  // Get attachment record and verify tenant via lead
  const { data: attachment, error } = await supabase
    .from("attachments")
    .select("*, leads!inner(tenant)")
    .eq("id", id)
    .single();

  if (error || !attachment || attachment.leads?.tenant !== tenant) {
    return Response.json({ error: "Bijlage niet gevonden" }, { status: 404 });
  }

  // Verify file exists in storage
  const { data: fileData, error: fileError } = await supabase.storage
    .from("attachments")
    .list(attachment.storage_path.split("/").slice(0, -1).join("/"), {
      search: attachment.storage_path.split("/").pop(),
    });

  if (fileError || !fileData?.length) {
    return Response.json(
      { error: "Bestand niet gevonden in storage — mogelijk verwijderd of niet correct geüpload" },
      { status: 404 }
    );
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
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  // Get attachment and verify tenant via lead
  const { data: attachment } = await supabase
    .from("attachments")
    .select("*, leads!inner(tenant)")
    .eq("id", id)
    .single();

  if (!attachment || attachment.leads?.tenant !== tenant) {
    return Response.json({ error: "Bijlage niet gevonden" }, { status: 404 });
  }

  // Delete from storage
  await supabase.storage
    .from("attachments")
    .remove([attachment.storage_path]);

  // Delete record
  const { error } = await supabase.from("attachments").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
