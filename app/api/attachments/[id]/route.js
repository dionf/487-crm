import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Supabase Storage refuses to serve html/svg with their stored content type —
// it downgrades them to text/plain so uploaded markup cannot run on the
// supabase.co origin. Opening such a file in a tab therefore shows source code.
// Only hand out an inline URL for types the browser renders as-is; everything
// else gets content-disposition: attachment so it downloads properly.
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const EXT_TO_TYPE = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function rendersInline(attachment) {
  const type = attachment.file_type || attachment.mime_type;
  if (type) return INLINE_TYPES.has(type.toLowerCase());
  // Rows written by the MCP server leave file_type empty — fall back to the extension.
  const ext = attachment.storage_path.split(".").pop()?.toLowerCase() || "";
  return INLINE_TYPES.has(EXT_TO_TYPE[ext]);
}

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
  const fileName =
    attachment.file_name ||
    attachment.filename ||
    attachment.storage_path.split("/").pop();
  const { data: signedData, error: signError } = await supabaseAdmin.storage
    .from("attachments")
    .createSignedUrl(
      attachment.storage_path,
      3600,
      rendersInline(attachment) ? undefined : { download: fileName }
    );

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
