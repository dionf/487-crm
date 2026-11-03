import { getVerifiedSession } from "@/lib/auth";
import { deleteContact, updateContact } from "@/lib/contacts";

export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const body = await request.json();
  const { id } = await params;

  try {
    const contact = await updateContact({ tenant: session.tenant, contactId: id, updates: body || {} });
    if (!contact) return Response.json({ error: "Contact niet gevonden" }, { status: 404 });
    return Response.json({ contact });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const { id } = await params;

  try {
    const deleted = await deleteContact({ tenant: session.tenant, contactId: id });
    if (!deleted) return Response.json({ error: "Contact niet gevonden" }, { status: 404 });
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
