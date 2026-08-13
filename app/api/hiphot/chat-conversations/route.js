import { requireVerifiedSession } from "@/lib/auth";
import { hiphotChatAdminFetch } from "@/lib/hiphot-chat-admin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const session = requireVerifiedSession(request);
    if (session.tenant !== "hiphot") {
      return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    for (const key of ["status", "lang", "source", "limit"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await hiphotChatAdminFetch(`/admin-chat-conversations${suffix}`);
    return Response.json(data);
  } catch (error) {
    const status = error instanceof Response ? error.status : 500;
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status });
  }
}
