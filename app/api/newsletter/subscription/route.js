import { normalizeEmail, requireAdmin, setEmailSubscription } from "@/lib/newsletters";

export const dynamic = "force-dynamic";

// Handmatig uit- of inschrijven van één e-mailadres (contact of algemeen
// bedrijfsadres): { email, subscribed: boolean, force?: boolean }.
export async function PATCH(request) {
  try {
    const { tenant, userName } = requireAdmin(request);
    const body = await request.json();
    const email = normalizeEmail(body.email);
    if (!email) return Response.json({ error: "Geldig e-mailadres is verplicht" }, { status: 400 });
    if (typeof body.subscribed !== "boolean") {
      return Response.json({ error: "subscribed (true/false) is verplicht" }, { status: 400 });
    }
    await setEmailSubscription({ tenant, email, subscribed: body.subscribed, userName, force: body.force === true });
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error.code === "needs_force") {
      return Response.json({ error: error.message, needs_force: true }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 400 });
  }
}
