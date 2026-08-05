import { getAuthCookie, verifyToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { processAutomaticBatchCampaign } from "@/lib/newsletters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

async function authorize(request) {
  const authHeader = request.headers.get("authorization");
  const isCronCall = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  if (isCronCall) return { cron: true, tenant: null, userName: "CRM cron" };

  const token = getAuthCookie(request);
  const session = token ? await verifyToken(token) : null;
  if (!session || session.role !== "admin") {
    throw Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { cron: false, tenant: session.tenant, userName: session.name || "CRM" };
}

async function handler(request) {
  try {
    const auth = await authorize(request);
    let query = supabaseAdmin
      .from("newsletter_campaigns")
      .select("*")
      .eq("status", "batch_waiting")
      .lte("batch_next_run_at", new Date().toISOString())
      .order("batch_next_run_at", { ascending: true })
      .limit(10);
    if (!auth.cron) query = query.eq("tenant", auth.tenant);

    const { data: campaigns, error } = await query;
    if (error) throw new Error(error.message);

    const results = [];
    for (const campaign of campaigns || []) {
      try {
        const updated = await processAutomaticBatchCampaign({
          tenant: campaign.tenant,
          campaign,
          userName: auth.userName,
        });
        results.push({
          id: campaign.id,
          tenant: campaign.tenant,
          name: campaign.name,
          status: updated.status,
          batch_current_number: updated.batch_current_number,
          batch_total_count: updated.batch_total_count,
          batch_next_run_at: updated.batch_next_run_at,
          pause_reason: updated.batch_pause_reason || null,
        });
      } catch (error) {
        results.push({
          id: campaign.id,
          tenant: campaign.tenant,
          name: campaign.name,
          status: "error",
          error: error.message,
        });
      }
    }

    return Response.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request) {
  return handler(request);
}

export async function POST(request) {
  return handler(request);
}
