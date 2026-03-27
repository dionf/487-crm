import { supabase } from "@/lib/supabase";
import { randomBytes } from "crypto";

export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json().catch(() => ({}));

  // Verify quote belongs to tenant
  const { data: existing } = await supabase
    .from("quotes").select("lead_id, leads(tenant)").eq("id", params.id).single();
  if (!existing || existing.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  // Generate unique hash
  const hash = randomBytes(16).toString("hex");
  const validDays = body.valid_days || 30;
  const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const updates = {
    public_hash: hash,
    valid_until: validUntil,
  };

  if (body.html_content) updates.html_content = body.html_content;
  if (body.template_type) updates.template_type = body.template_type;

  const { data, error } = await supabase
    .from("quotes")
    .update(updates)
    .eq("id", params.id)
    .select("*, leads(company_name)")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  if (data.lead_id) {
    await supabase.from("activities").insert({
      lead_id: data.lead_id,
      activity_type: "quote_published",
      description: `Offerte ${data.quote_number} gepubliceerd — geldig tot ${validUntil}`,
      created_by: body.created_by || "CRM",
      tenant,
    });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.48-7.nl";

  return Response.json({
    quote: data,
    public_url: `${baseUrl}/offerte/${hash}`,
    valid_until: validUntil,
  });
}
