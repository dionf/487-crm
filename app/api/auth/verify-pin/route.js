import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";
import { signToken } from "@/lib/auth";
import { NextResponse } from "next/server";

const COOKIE_NAME = "crm-auth";

// POST /api/auth/verify-pin — verify user pin and set auth cookie
export async function POST(request) {
  const { user_id, pin } = await request.json();

  if (!user_id || !pin) {
    return Response.json({ error: "user_id and pin are required" }, { status: 400 });
  }

  // Hash the provided pin
  const pinHash = createHash("sha256").update(pin).digest("hex");

  // Fetch user with org info
  const { data: user, error } = await supabase
    .from("users")
    .select("id, name, email, role, organization_id, pin_hash, organizations(id, slug, display_name, pipeline_stages, service_types, theme)")
    .eq("id", user_id)
    .eq("is_active", true)
    .single();

  if (error || !user) {
    return Response.json({ error: "Gebruiker niet gevonden" }, { status: 404 });
  }

  if (user.pin_hash !== pinHash) {
    return Response.json({ error: "Onjuiste pincode" }, { status: 401 });
  }

  // Create JWT payload
  const tokenPayload = {
    user_id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenant: user.organizations.slug,
    org_id: user.organizations.id,
  };

  const token = await signToken(tokenPayload);

  // Build session data for client (UI state)
  const sessionData = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    organization: user.organizations,
    tenant: user.organizations.slug,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  // Set httpOnly cookie with JWT and return session data for UI
  const response = NextResponse.json({ success: true, session: sessionData });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h
  });

  return response;
}
