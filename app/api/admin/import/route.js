import { supabase } from "@/lib/supabase";

// POST /api/admin/import — bulk import leads
export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");

  // Admin only
  if (role !== "admin") {
    return Response.json({ error: "Alleen admins kunnen importeren" }, { status: 403 });
  }

  const body = await request.json();
  const { leads, default_status } = body;

  if (!leads || !Array.isArray(leads) || leads.length === 0) {
    return Response.json({ error: "Geen leads om te importeren" }, { status: 400 });
  }

  const results = { imported: 0, duplicates: 0, errors: 0, details: [] };

  for (const lead of leads) {
    try {
      // Check duplicate on company_name + email within same tenant
      if (lead.company_name && lead.email) {
        const { data: existing } = await supabase
          .from("leads")
          .select("id")
          .eq("tenant", tenant)
          .eq("company_name", lead.company_name)
          .eq("email", lead.email)
          .maybeSingle();

        if (existing) {
          results.duplicates++;
          results.details.push({ company: lead.company_name, status: "duplicate" });
          continue;
        }
      }

      // Extract website from email if not provided
      let websiteUrl = lead.website_url || null;
      if (!websiteUrl && lead.email?.includes("@")) {
        const domain = lead.email.split("@")[1]?.toLowerCase();
        const freeDomains = ["gmail.com","hotmail.com","hotmail.nl","outlook.com","outlook.nl","live.com","live.nl","yahoo.com","yahoo.nl","icloud.com","ziggo.nl","kpnmail.nl","xs4all.nl","protonmail.com"];
        if (domain && !freeDomains.includes(domain)) {
          websiteUrl = `https://${domain}`;
        }
      }

      const { error } = await supabase.from("leads").insert({
        company_name: lead.company_name || "Onbekend",
        contact_person: lead.contact_person || "-",
        email: lead.email || null,
        phone: lead.phone || null,
        website_url: websiteUrl,
        city: lead.city || null,
        category: lead.category || null,
        industry: lead.industry || null,
        address: lead.address || null,
        internal_notes: lead.internal_notes || null,
        status: default_status || "nieuwe_aanvraag",
        tenant,
      });

      if (error) {
        results.errors++;
        results.details.push({ company: lead.company_name, status: "error", error: error.message });
      } else {
        results.imported++;
      }
    } catch (err) {
      results.errors++;
      results.details.push({ company: lead.company_name, status: "error", error: err.message });
    }
  }

  return Response.json({ success: true, results });
}
