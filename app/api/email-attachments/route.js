import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (!tenant) {
    return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("email_standard_attachments")
    .select("*")
    .eq("tenant", tenant)
    .order("sort_order", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ attachments: data });
}

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");
  if (!tenant || role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const name = formData.get("name");

  if (!file || !name) {
    return Response.json({ error: "file en name zijn verplicht" }, { status: 400 });
  }

  const fileName = file.name;
  const storagePath = `email-attachments/${tenant}/${Date.now()}_${fileName}`;

  // Upload to Supabase Storage
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
    });

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  // Insert DB record
  const { data, error } = await supabase
    .from("email_standard_attachments")
    .insert({
      tenant,
      name,
      file_name: fileName,
      storage_path: storagePath,
      file_size: buffer.length,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ attachment: data });
}

export async function DELETE(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");
  if (!tenant || role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) {
    return Response.json({ error: "id is verplicht" }, { status: 400 });
  }

  // Get record first (tenant check)
  const { data: att } = await supabase
    .from("email_standard_attachments")
    .select("*")
    .eq("id", id)
    .eq("tenant", tenant)
    .single();

  if (!att) {
    return Response.json({ error: "Bijlage niet gevonden" }, { status: 404 });
  }

  // Delete from storage
  await supabase.storage.from("attachments").remove([att.storage_path]);

  // Delete DB record
  const { error } = await supabase
    .from("email_standard_attachments")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
