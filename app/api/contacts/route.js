import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addContact } from "@/lib/contacts";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get("lead_id");
  const marketingOnly = searchParams.get("marketing") === "true";
  const tenant = session.tenant;

  let q = supabaseAdmin
    .from("contacts")
    .select("*, leads(company_name)")
    .eq("tenant", tenant)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });

  if (leadId) q = q.eq("lead_id", leadId);
  if (marketingOnly) q = q.eq("marketing_consent", true);

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ contacts: data });
}

export async function POST(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const body = await request.json();

  const { lead_id, name, email, phone, role, is_primary, marketing_consent } = body;
  if (!lead_id || !name) {
    return Response.json({ error: "lead_id en name zijn verplicht" }, { status: 400 });
  }

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("id", lead_id)
    .eq("tenant", tenant)
    .single();

  if (!lead) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  let data;
  try {
    data = await addContact({
      tenant,
      leadId: lead_id,
      name,
      email,
      phone,
      role,
      isPrimary: is_primary,
      marketingConsent: marketing_consent,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ contact: data });
}
