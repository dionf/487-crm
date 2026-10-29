// Haalt de leesbare tekst van een website op (max ~3000 tekens), voor AI-analyses.
export async function scrapeWebsite(url) {
  // Try multiple URL variations
  const urls = [url];
  if (!url.includes("www.")) {
    urls.push(url.replace("https://", "https://www."));
  }

  for (const tryUrl of urls) {
    try {
      const res = await fetch(tryUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      if (!html || html.length < 100) continue;

    // Strip scripts, styles, tags — keep text content
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Limit to ~3000 chars to stay within token budget
    if (text.length > 3000) {
      text = text.substring(0, 3000) + "...";
    }

      return text;
    } catch {
      continue;
    }
  }
  return null;
}
