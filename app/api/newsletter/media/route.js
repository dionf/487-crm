import { requireAdmin } from "@/lib/newsletters";
import { importImageFromUrl, readUploadedFile, uploadPublicImage } from "@/lib/media";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Afbeelding voor een nieuwsbrief (item of kopbeeld): upload (multipart "file")
// of { url } van een externe afbeelding. Geeft de publieke URL terug.
export async function POST(request) {
  try {
    const { tenant, userId } = requireAdmin(request);
    const gate = await enforceRateLimit({
      request,
      policy: "session-expensive",
      identifier: userId,
      scope: "/api/newsletter/media",
      tenant,
    });
    if (gate.response) return gate.response;

    let url;
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const buffer = await readUploadedFile(await request.formData());
      url = await uploadPublicImage({ tenant, folder: "newsletter", buffer });
    } else {
      const body = await request.json();
      if (!body.url) throw new Error("Geef een bestand of een URL");
      url = await importImageFromUrl({ tenant, folder: "newsletter", url: String(body.url).trim() });
    }
    return Response.json({ url });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}
