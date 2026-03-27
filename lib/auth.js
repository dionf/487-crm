import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "crm-auth";
const JWT_SECRET_KEY = process.env.JWT_SECRET || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getSecretKey() {
  if (!JWT_SECRET_KEY) throw new Error("JWT_SECRET env var is required");
  return new TextEncoder().encode(JWT_SECRET_KEY);
}

// Sign a JWT with session payload
export async function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecretKey());
}

// Verify and decode a JWT
export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload;
  } catch {
    return null;
  }
}

// Set the auth cookie on a Response
export function setAuthCookie(response, token) {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });
  return response;
}

// Clear the auth cookie
export function clearAuthCookie(response) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

// Get auth cookie value from a Request (works in API routes and middleware)
export function getAuthCookie(request) {
  return request.cookies.get(COOKIE_NAME)?.value || null;
}

// Verify auth and return session from request — use in API routes
// Returns { user_id, name, email, role, tenant, org_id } or null
export async function getSession(request) {
  const token = getAuthCookie(request);
  if (!token) return null;
  return verifyToken(token);
}

// Require auth — returns session or throws a 401 Response
// Usage: const session = await requireAuth(request);
export async function requireAuth(request) {
  const session = await getSession(request);
  if (!session) {
    throw Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  return session;
}

// Read verified session from middleware-injected headers (fast, no crypto)
// Use this in API routes — middleware already verified the JWT
export function getVerifiedSession(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (!tenant) return null;
  return {
    user_id: request.headers.get("x-auth-user-id"),
    tenant,
    role: request.headers.get("x-auth-role"),
    name: decodeURIComponent(request.headers.get("x-auth-name") || ""),
  };
}

// Require verified session from middleware — returns session or 401
export function requireVerifiedSession(request) {
  const session = getVerifiedSession(request);
  if (!session) {
    throw Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  return session;
}
