import {
  getNewsletterSettings,
  isMissingNewsletterTable,
  missingNewsletterSetupResponse,
  requireAdmin,
  upsertNewsletterSettings,
} from "@/lib/newsletters";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);
    const settings = await getNewsletterSettings(tenant);
    return Response.json({ settings });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { tenant } = requireAdmin(request);
    const body = await request.json();
    const settings = await upsertNewsletterSettings(tenant, body);
    return Response.json({ settings });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isMissingNewsletterTable(error)) return missingNewsletterSetupResponse();
    return Response.json({ error: error.message }, { status: 400 });
  }
}
