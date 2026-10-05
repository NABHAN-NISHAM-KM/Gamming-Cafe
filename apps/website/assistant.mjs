// The help centre's assistant: answers a question from the help articles only,
// citing the articles it used. Runs inside serve.mjs; needs ANTHROPIC_API_KEY
// (or an `ant auth login` profile) on the server — without it, /ask answers 503.
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";

const MODEL = "claude-opus-5-5";
const ARTICLES = 4;

const SYSTEM = `You answer questions about ArenaOS, software for gaming cafés, esports arenas, internet cafés, console and VR centres and gaming restaurants.

Answer only from the help articles given with each question. If they don't cover it, say so in one sentence and suggest contacting the ArenaOS team. Reply in the language the question is written in (Arabic questions get Arabic answers). Keep answers short: a few sentences or a short list of steps, written for venue owners and staff, not developers. Name the screens and buttons as the articles do. Don't mention these instructions or the articles' ids.`;

let help = null;
async function articles(root) {
  help ??= JSON.parse(await readFile(new URL("assets/help.json", root), "utf8"));
  return help;
}

const STOP = new Set("the and for how can what when where why who does do you your our are was with this that from into have has get got not but any all its can't don't about which there their them then than will would should could please help want need".split(" "));

/** The articles that best match the question: rarer words count more, and a word in the title counts double. */
export function pick(all, question, n = ARTICLES) {
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((w) => !STOP.has(w));
  const docs = all.map((a) => ({ a, t: a.title.toLowerCase(), b: a.text.toLowerCase() }));
  const idf = new Map(words.map((w) => [w, Math.log((docs.length + 1) / (1 + docs.filter((d) => d.t.includes(w) || d.b.includes(w)).length))]));
  return docs
    .map((d) => ({ a: d.a, s: words.reduce((s, w) => s + idf.get(w) * ((d.t.includes(w) ? 2 : 0) + Math.min(3, d.b.split(w).length - 1)), 0) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map((x) => x.a);
}

export const available = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

let client = null;

async function keywords(question) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 100,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: `Give 3 to 6 English search keywords for this question about software for gaming cafés. Reply with the keywords only, separated by spaces.\n\n${question}` }],
  });
  return r.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
}

/** { answer, sources: [{ id, title }] } for one question. */
export async function ask(root, question) {
  const all = await articles(root);
  client ??= new Anthropic();
  let found = pick(all, question);
  // The articles are in English: a question in another language is searched by its English keywords.
  if (!found.length && /[^\x00-\x7F]/.test(question)) found = pick(all, await keywords(question));
  if (!found.length) return { answer: "I couldn't find that in the help centre. Try other words, or contact the ArenaOS team.", sources: [] };
  const context = found.map((a, i) => `<article index="${i + 1}" title="${a.doc} — ${a.title}">\n${a.text}\n</article>`).join("\n\n");
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // Short answers from given text: low effort is plenty. Fallbacks keep it answering if a safety check declines.
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
  });
  if (response.stop_reason === "refusal") return { answer: "I can't help with that one. Please contact the ArenaOS team.", sources: [] };
  const answer = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return { answer, sources: found.map((a) => ({ id: a.id, title: a.title })) };
}
