import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  // Get attachment record and verify tenant via lead
  const { data: attachment, error } = await supabaseAdmin
    .from("attachments")
    .select("*, leads!inner(tenant)")
    .eq("id", id)
    .single();

  if (error || !attachment || attachment.leads?.tenant !== tenant) {
    return Response.json({ error: "Bijlage niet gevonden" }, { status: 404 });
  }

  // Verify file exists in storage
  const { data: fileData, error: fileError } = await supabaseAdmin.storage
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
  const { data: signedData, error: signError } = await supabaseAdmin.storage
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
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  // Get attachment and verify tenant via lead
  const { data: attachment } = await supabaseAdmin
    .from("attachments")
    .select("*, leads!inner(tenant)")
    .eq("id", id)
    .single();

  if (!attachment || attachment.leads?.tenant !== tenant) {
    return Response.json({ error: "Bijlage niet gevonden" }, { status: 404 });
  }

  // Delete from storage
  await supabaseAdmin.storage
    .from("attachments")
    .remove([attachment.storage_path]);

  // Delete record
  const { error } = await supabaseAdmin.from("attachments").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
