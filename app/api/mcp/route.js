import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateBearer, CORS_HEADERS, getOrigin, protectedResourceMetadataUrl } from "@/lib/oauth";
import { registerCrmTools } from "@/lib/mcp/tools";
import { getBlock, getClientIp, registerFailedAttempt, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MCP_CORS = {
  ...CORS_HEADERS,
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, mcp-session-id",
};

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(MCP_CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Zonder (geldig) token: 401 met een verwijzing naar de resource-metadata.
// Daarmee start Claude zelf de OAuth-flow.
function unauthorized(request, description) {
  const metadata = protectedResourceMetadataUrl(getOrigin(request));
  const params = [`resource_metadata="${metadata}"`];
  if (description) params.push(`error="invalid_token"`, `error_description="${description}"`);
  return new Response(JSON.stringify({ error: "invalid_token", error_description: description || "Inloggen vereist" }), {
    status: 401,
    headers: {
      ...MCP_CORS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "WWW-Authenticate": `Bearer ${params.join(", ")}`,
    },
  });
}

/**
 * POST /api/mcp — MCP over Streamable HTTP, stateless: per request een
 * nieuwe server met de tools van precies deze gebruiker. Geen sessies, dus
 * geen gedeelde opslag nodig tussen serverless-instanties.
 */
async function handle(request) {
  const ip = getClientIp(request);
  const block = await getBlock("mcp-token-miss", ip);
  if (block) return withCors(tooManyRequests(block.retryAfter));

  const { auth, present, unknown } = await authenticateBearer(request);
  if (!auth) {
    if (unknown) {
      await registerFailedAttempt({
        request,
        policy: "mcp-token-miss",
        identifier: ip,
        scope: "/api/mcp",
        reason: "Onbekend bearer token op MCP-endpoint",
      });
    }
    return unauthorized(request, present ? "Token ongeldig, verlopen of ingetrokken" : null);
  }

  const origin = getOrigin(request);
  const server = new McpServer(
    { name: "48-7 CRM", version: "2.0.0" },
    {
      instructions:
        `CRM van ${auth.user.organizations.display_name} (tenant ${auth.tenant}). ` +
        `Je werkt als ${auth.user.name}; alle tools zijn beperkt tot deze organisatie en acties staan op diens naam. ` +
        `Gebruik deze tools voor leads, bedrijven, trajecten, notities, to-do's, follow-ups en offertes. ` +
        `Links naar records: ${origin}/leads/<lead_id>.`,
    }
  );
  registerCrmTools(server, {
    user: auth.user,
    tenant: auth.tenant,
    orgName: auth.user.organizations.display_name,
    origin,
    request,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    // Stateless: de response is volledig opgebouwd (JSON-modus), dus de
    // server kan direct dicht.
    server.close().catch(() => {});
  }
}

export const POST = handle;

// Geen SSE-stream en geen sessies in stateless modus.
export async function GET(request) {
  const { auth } = await authenticateBearer(request);
  if (!auth) return unauthorized(request, null);
  return new Response(JSON.stringify({ error: "Gebruik POST (Streamable HTTP, stateless)" }), {
    status: 405,
    headers: { ...MCP_CORS, Allow: "POST", "Content-Type": "application/json" },
  });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { ...MCP_CORS, Allow: "POST" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS });
}
