import { validateAuthorizeRequest } from "@/lib/oauth";
import AuthorizeForm from "./AuthorizeForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Claude koppelen | 48-7 CRM",
  robots: { index: false },
};

const PARAM_KEYS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
];

// GET /oauth/authorize — inlogpagina van de OAuth-flow voor de MCP-connector.
// Een ongeldige client of redirect-URI tonen we hier, zonder door te sturen:
// de URI is dan zelf niet te vertrouwen.
export default async function AuthorizePage({ searchParams }) {
  const params = Object.fromEntries(
    PARAM_KEYS.map((k) => [k, typeof searchParams?.[k] === "string" ? searchParams[k] : undefined])
  );
  const check = await validateAuthorizeRequest(params);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm mx-auto px-6 py-10">
        {check.error ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-brand-black">Koppeling niet mogelijk</h1>
            <p className="text-sm text-gray-500 mt-2">{check.error}</p>
          </div>
        ) : (
          <AuthorizeForm
            params={params}
            clientName={check.client.client_name}
            invalid={check.redirectError ? true : false}
          />
        )}
      </div>
    </div>
  );
}
