import { requireVerifiedSession } from "@/lib/auth";
import { hiphotChatAdminFetch } from "@/lib/hiphot-chat-admin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const session = requireVerifiedSession(request);
    if (session.tenant !== "hiphot") {
      return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
    }

    const data = await hiphotChatAdminFetch("/admin-chat-configs");
    return Response.json(data);
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const session = requireVerifiedSession(request);
    if (session.tenant !== "hiphot") {
      return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
    }
    if (session.role !== "admin") {
      return Response.json({ error: "Alleen admins mogen prompts wijzigen" }, { status: 403 });
    }

    const body = await request.json();
    const data = await hiphotChatAdminFetch("/admin-chat-configs", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return Response.json(data);
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = requireVerifiedSession(request);
    if (session.tenant !== "hiphot") {
      return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
    }
    if (session.role !== "admin") {
      return Response.json({ error: "Alleen admins mogen prompt-varianten activeren" }, { status: 403 });
    }

    const body = await request.json();
    const data = await hiphotChatAdminFetch("/admin-chat-configs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return Response.json(data);
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}
