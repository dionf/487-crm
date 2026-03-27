import { NextResponse } from "next/server";
import { getAuthCookie, verifyToken } from "@/lib/auth";

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/api/auth/",         // Login flow
  "/api/poll-inbox",    // Cron job (has own CRON_SECRET auth)
  "/api/track/",        // Public tracking pixel
  "/api/public/",       // Public quote pages
];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes (pages are protected by PinGate client-side)
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow public API routes
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Verify auth cookie
  const token = getAuthCookie(request);
  if (!token) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const session = await verifyToken(token);
  if (!session) {
    return NextResponse.json({ error: "Sessie verlopen" }, { status: 401 });
  }

  // Pass verified session data to API routes via request headers
  // These headers are trusted because middleware set them (client can't spoof them)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-auth-user-id", session.user_id);
  requestHeaders.set("x-auth-tenant", session.tenant);
  requestHeaders.set("x-auth-role", session.role);
  requestHeaders.set("x-auth-name", encodeURIComponent(session.name));
  // Remove the old spoofable header
  requestHeaders.delete("x-tenant");

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/api/:path*"],
};
