import { authorizationServerMetadata, CORS_HEADERS, getOrigin, oauthJson } from "@/lib/oauth";

export const dynamic = "force-dynamic";

// RFC 8414. Ook bereikbaar met een padsuffix (/…/api/mcp): sommige clients
// plakken het resourcepad erachter.
export function GET(request) {
  return oauthJson(authorizationServerMetadata(getOrigin(request)));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
