import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const emailIds = searchParams.get("email_ids");

  if (!emailIds) {
    return Response.json({ attachments: [] });
  }

  const ids = emailIds.split(",").filter(Boolean);
  if (ids.length === 0) {
    return Response.json({ attachments: [] });
  }

  const { data, error } = await supabase
    .from("quote_email_attachments")
    .select("*")
    .in("email_id", ids);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ attachments: data });
}
