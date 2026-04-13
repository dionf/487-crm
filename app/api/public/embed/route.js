import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

// Cache the file content in memory after first read
let cachedJs = null;

export async function GET() {
  if (!cachedJs) {
    const filePath = join(process.cwd(), "public", "form-embed.js");
    cachedJs = readFileSync(filePath, "utf-8");
  }

  return new NextResponse(cachedJs, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
