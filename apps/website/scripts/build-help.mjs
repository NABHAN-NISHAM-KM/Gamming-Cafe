// Builds the website's help centre (assets/help.json) from the user-facing docs:
// one article per "## " section, rendered to HTML here so the page stays static.
// Run after editing docs: `npm run build:help -w @arena/website`.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, slug } from "./markdown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, "../../../docs");
// Architecture, ERD, RBAC internals, API and the test guide are for developers, not venues.
const SKIP = /^(0[1-7]|16)-/;

const files = (await readdir(docsDir)).filter((f) => f.endsWith(".md") && !SKIP.test(f)).sort();
const firstSection = {};
const parsed = [];
for (const f of files) {
  const md = await readFile(join(docsDir, f), "utf8");
  const doc = f.replace(/\.md$/, "");
  const title = (md.match(/^# (.+)$/m)?.[1] ?? doc).replace(/^\d+\s*·\s*/, "").replace(/\s*\(Phases? [^)]*\)/, "");
  const parts = md.split(/^## /m);
  const intro = parts.shift().replace(/^# .+$/m, "").trim();
  const sections = [...(intro ? [["Overview", intro]] : []), ...parts.map((p) => [p.slice(0, p.indexOf("\n")).trim(), p.slice(p.indexOf("\n") + 1)])];
  firstSection[f] = `${doc}--${slug(sections[0]?.[0] ?? "overview")}`;
  parsed.push({ doc, title, sections });
}
const link = (href) => {
  const [file, hash] = href.split("#");
  if (/^https?:/.test(href)) return href;
  if (firstSection[file]) return `#${firstSection[file]}`;
  if (!file && hash) return `#${hash}`;
  return "#";
};
const articles = parsed.flatMap(({ doc, title, sections }) =>
  sections.map(([heading, body]) => ({
    id: `${doc}--${slug(heading)}`,
    doc: title,
    title: heading,
    html: render(body, link),
    text: body.replace(/[`*#>|[\]()_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000),
  })),
);
await writeFile(join(here, "../assets/help.json"), JSON.stringify(articles));
console.log(`help: ${articles.length} articles from ${files.length} docs`);
