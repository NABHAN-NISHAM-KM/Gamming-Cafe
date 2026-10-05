// Builds the blog (blog/*.html, blog/index.html, blog/feed.xml) from posts/*.md.
// Each post starts with front matter: title, date (YYYY-MM-DD), description.
// Run after adding or editing a post: `npm run build:blog -w @arena/website`.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { esc, render } from "./markdown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const out = join(site, "blog");

const posts = [];
for (const f of (await readdir(join(site, "posts"))).filter((f) => f.endsWith(".md"))) {
  const md = (await readFile(join(site, "posts", f), "utf8")).replace(/\r\n/g, "\n");
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${f}: missing front matter`);
  const meta = Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  for (const k of ["title", "date", "description"]) if (!meta[k]) throw new Error(`${f}: no ${k}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`${f}: date must be YYYY-MM-DD`);
  // "## " headings become <h2>; the shared renderer handles everything below them.
  const html = m[2].trim().split(/^## /m).map((part, i) => (i === 0 ? render(part, (h) => h) : `<h2>${esc(part.slice(0, part.indexOf("\n")).trim())}</h2>\n${render(part.slice(part.indexOf("\n") + 1), (h) => h)}`)).join("\n");
  posts.push({ slug: f.replace(/\.md$/, ""), ...meta, html });
}
posts.sort((a, b) => b.date.localeCompare(a.date));

const day = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const attr = (s) => esc(s).replace(/"/g, "&quot;");

const page = ({ title, description, path, body, type = "website" }) => `<!doctype html>
<html lang="en" data-page="blog" data-base="../">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}" />
  <link rel="canonical" href="%SITE%/${path}" />
  <meta property="og:type" content="${type}" />
  <meta property="og:site_name" content="ArenaOS" />
  <meta property="og:title" content="${attr(title)}" />
  <meta property="og:description" content="${attr(description)}" />
  <meta property="og:url" content="%SITE%/${path}" />
  <meta property="og:image" content="%SITE%/assets/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="alternate" type="application/rss+xml" title="ArenaOS blog" href="%SITE%/blog/feed.xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/site.css?v=7" />
  <style>
    .post { max-width: 760px; padding-bottom: 96px; }
    .post h2 { font-size: clamp(28px, 3.4vw, 40px); margin: 40px 0 12px; }
    .post p, .post li { color: var(--ink-2); line-height: 1.75; font-size: 17px; }
    .post a { color: var(--accent); }
    .card { display: block; border-bottom: 1px solid var(--line); padding: 24px 0; color: inherit; text-decoration: none; }
    .card b { display: block; font-size: 22px; color: var(--ink); } .card p { color: var(--ink-2); margin: 6px 0 0; }
    .card small, .date { font: 12px var(--mono); color: var(--ink-3); }
  </style>
</head>
<body>
  <header id="nav"></header>
  <main>
${body}
  </main>
  <footer id="footer"></footer>
  <script src="../assets/site.js?v=7"></script>
</body>
</html>
`;

const hero = (eyebrow, h1, lead) => `    <section class="hero" style="border-bottom:0;padding-bottom:16px">
      <div class="hero-grid"></div>
      <div class="wrap">
        <span class="eyebrow">${eyebrow}</span>
        <h1 style="font-size:clamp(40px,5.5vw,84px)!important">${esc(h1)}</h1>
        ${lead}
      </div>
    </section>`;

await mkdir(out, { recursive: true });
for (const p of posts) {
  await writeFile(join(out, `${p.slug}.html`), page({
    title: `${p.title} — ArenaOS blog`, description: p.description, path: `blog/${p.slug}.html`, type: "article",
    body: `${hero(`<a href="./" style="color:inherit">Blog</a>`, p.title, `<p class="date">${day(p.date)}</p>`)}
    <article class="wrap post">
${p.html}
    </article>`,
  }));
}
await writeFile(join(out, "index.html"), page({
  title: "Blog — guides for gaming venues — ArenaOS", description: "Practical guides for running a gaming café, esports arena or console and VR centre: pricing, tournaments, switching software and more.", path: "blog/",
  body: `${hero("Blog", "Guides for gaming venues", `<p class="lead">Pricing, tournaments, staff and running the floor — practical notes for owners and managers. <a href="feed.xml" style="color:var(--accent)">RSS</a></p>`)}
    <div class="wrap post">
${posts.map((p) => `      <a class="card" href="${p.slug}.html"><small>${day(p.date)}</small><b>${esc(p.title)}</b><p>${esc(p.description)}</p></a>`).join("\n")}
    </div>`,
}));
await writeFile(join(out, "feed.xml"), `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>ArenaOS blog</title>
  <link>%SITE%/blog/</link>
  <atom:link href="%SITE%/blog/feed.xml" rel="self" type="application/rss+xml" />
  <description>Guides for gaming cafés, esports arenas and console and VR centres.</description>
  <language>en</language>
${posts.map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>%SITE%/blog/${p.slug}.html</link>
    <guid>%SITE%/blog/${p.slug}.html</guid>
    <pubDate>${new Date(`${p.date}T08:00:00Z`).toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
  </item>`).join("\n")}
</channel>
</rss>
`);
console.log(`blog: ${posts.length} posts`);
