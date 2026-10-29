import { CORS_HEADERS, getOrigin, oauthJson, protectedResourceMetadata } from "@/lib/oauth";

export const dynamic = "force-dynamic";

// RFC 9728: vertelt Claude welke authorization server bij /api/mcp hoort.
export function GET(request) {
  return oauthJson(protectedResourceMetadata(getOrigin(request)));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
