import Anthropic from "@anthropic-ai/sdk";
import { NEWSLETTER_MODEL } from "@/lib/ai-models";

// Claude-aanroepen voor de nieuwsbrief. Het model denkt altijd mee en die
// denktokens tellen mee in max_tokens, dus ruime marge; effort houdt de kosten laag.
const MAX_TOKENS = 16000;
const EFFORT = "medium";

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("API key niet geconfigureerd");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function create(prompt, outputConfig = {}) {
  const resp = await client().messages.create({
    model: NEWSLETTER_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT, ...outputConfig },
    messages: [{ role: "user", content: prompt }],
  });
  if (resp.stop_reason === "refusal") throw new Error("Claude weigerde deze tekst te schrijven");
  if (resp.stop_reason === "max_tokens") throw new Error("Het antwoord van Claude werd afgekapt");
  const text = resp.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Claude gaf een leeg antwoord terug");
  return text;
}

export function generateNewsletterText(prompt) {
  return create(prompt);
}

// Structured output: het antwoord voldoet gegarandeerd aan het JSON-schema
// (elk object met additionalProperties: false en alle velden in required).
export async function generateNewsletterJson(prompt, schema) {
  const text = await create(prompt, { format: { type: "json_schema", schema } });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Claude gaf geen geldige JSON terug");
  }
}
