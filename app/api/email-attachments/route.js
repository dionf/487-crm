import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) {
    return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const tenant = session.tenant;

  const { data, error } = await supabaseAdmin
    .from("email_standard_attachments")
    .select("*")
    .eq("tenant", tenant)
    .order("sort_order", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ attachments: data });
}

// POST: create a signed upload URL + DB record (file uploads directly to Supabase from client)
export async function POST(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  const tenant = session.tenant;

  const body = await request.json();
  const { name, file_name, file_size, content_type } = body;

  if (!name || !file_name) {
    return Response.json({ error: "name en file_name zijn verplicht" }, { status: 400 });
  }

  const storagePath = `email-attachments/${tenant}/${Date.now()}_${file_name}`;

  // Create signed upload URL (valid for 2 minutes)
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from("attachments")
    .createSignedUploadUrl(storagePath);

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  // Insert DB record
  const { data, error } = await supabaseAdmin
    .from("email_standard_attachments")
    .insert({
      tenant,
      name,
      file_name,
      storage_path: storagePath,
      file_size: file_size || null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    attachment: data,
    upload_url: uploadData.signedUrl,
    upload_token: uploadData.token,
    storage_path: storagePath,
  });
}

export async function DELETE(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  const tenant = session.tenant;

  const { id } = await request.json();
  if (!id) {
    return Response.json({ error: "id is verplicht" }, { status: 400 });
  }

  // Get record first (tenant check)
  const { data: att } = await supabaseAdmin
    .from("email_standard_attachments")
    .select("*")
    .eq("id", id)
    .eq("tenant", tenant)
    .single();

  if (!att) {
    return Response.json({ error: "Bijlage niet gevonden" }, { status: 404 });
  }

  // Delete from storage
  await supabaseAdmin.storage.from("attachments").remove([att.storage_path]);

  // Delete DB record
  const { error } = await supabaseAdmin
    .from("email_standard_attachments")
    .delete()
    .eq("id", id)
    .eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
