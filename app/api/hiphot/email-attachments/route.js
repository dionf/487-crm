import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { searchParams } = new URL(request.url);
  const emailIds = searchParams.get("email_ids");

  if (!emailIds) {
    return Response.json({ attachments: [] });
  }

  const ids = emailIds.split(",").filter(Boolean);
  if (ids.length === 0) {
    return Response.json({ attachments: [] });
  }

  const { data: emails, error: emailError } = await supabaseAdmin
    .from("quote_emails")
    .select("id")
    .eq("tenant", tenant)
    .in("id", ids);
  if (emailError) {
    return Response.json({ error: emailError.message }, { status: 500 });
  }

  const allowedIds = (emails || []).map((email) => email.id);
  if (!allowedIds.length) {
    return Response.json({ attachments: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("quote_email_attachments")
    .select("*")
    .in("email_id", allowedIds);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ attachments: data });
}
