// Social posts bij nieuwsbriefitems: gedeeld door server en editor.

export const SOCIAL_CHANNELS = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
];

export const SOCIAL_CHANNEL_IDS = SOCIAL_CHANNELS.map((channel) => channel.id);

// "ai mkb, #Automatisering" -> ["#ai", "#mkb", "#Automatisering"]
export function normalizeHashtags(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    const tag = String(entry || "").trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    result.push(`#${tag}`);
  }
  return result;
}

// Valideert de inhoud van een post (na genereren of bewerken).
export function normalizeSocialContent(channel, content = {}) {
  const text = (field) => String(content[field] ?? "").trim();
  if (channel === "linkedin") {
    const post = { hook: text("hook"), body: text("body"), hashtags: normalizeHashtags(content.hashtags) };
    if (!post.hook && !post.body) throw new Error("Een LinkedIn-post heeft een hook of tekst nodig");
    return post;
  }
  if (channel === "instagram") {
    const post = {
      caption: text("caption"),
      hashtags: normalizeHashtags(content.hashtags),
      image_suggestion: text("image_suggestion"),
    };
    if (!post.caption) throw new Error("Een Instagram-post heeft een caption nodig");
    return post;
  }
  throw new Error("Onbekend kanaal");
}

// De tekst zoals hij op het kanaal geplakt wordt.
export function formatSocialPost(channel, content = {}) {
  const tags = (content.hashtags || []).join(" ");
  const parts = channel === "linkedin" ? [content.hook, content.body, tags] : [content.caption, tags];
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");
}
