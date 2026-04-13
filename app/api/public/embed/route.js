import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-static";
export const revalidate = 86400; // 24h

export async function GET() {
  const filePath = join(process.cwd(), "public", "form-embed.js");
  const js = readFileSync(filePath, "utf-8");

  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
