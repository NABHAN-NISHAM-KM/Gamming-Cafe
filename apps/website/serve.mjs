// Zero-dependency static server for the marketing site: `npm run dev -w @arena/website`.
// Also hosts the live demos built by `npm run build:demos` under /live/, and
// forwards the site's few API calls (leads, demo slots, trial, releases → the
// platform service; venue pages → the API) so the browser never needs CORS.
// Also: the status page's uptime monitor, and the help centre's assistant (/ask).
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createMonitor } from "./status.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5180);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/rss+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".apk": "application/vnd.android.package-archive",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".zip": "application/zip",
};
const compressible = new Set([".html", ".css", ".js", ".mjs", ".json", ".txt", ".svg", ".webmanifest"]);
// The server's own files are never served.
const PRIVATE = /^(serve|assistant|status)\.mjs$|^status-data\.json$|^package(-lock)?\.json$|^(scripts|posts)[\\/]|^node_modules[\\/]/;
const monitor = createMonitor(join(root, "status-data.json"));
if (process.env.STATUS_MONITOR !== "off") {
  void monitor.check();
  setInterval(() => void monitor.check(), 60_000).unref();
}

/** Per-IP sliding window (the assistant costs money per question). */
const asked = new Map();
const mayAsk = (ip) => {
  const now = Date.now();
  const recent = (asked.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 10) return false;
  asked.set(ip, [...recent, now]);
  return true;
};
const readJson = (req, max = 4096) =>
  new Promise((ok, fail) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > max) fail(new Error("too large"));
    });
    req.on("end", () => {
      try {
        ok(JSON.parse(raw || "{}"));
      } catch (e) {
        fail(e);
      }
    });
  });
const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-cache" });
  res.end(JSON.stringify(body));
};

const upstreams = [
  ["/v1/public/", process.env.PLATFORM_URL ?? "http://localhost:4100"],
  ["/v1/app/", process.env.API_URL ?? "http://localhost:4000"],
];

function proxy(req, res, target) {
  const u = new URL(req.url, target);
  // Behind a local reverse proxy (Caddy, Nginx) keep the visitor's address it sent; otherwise the
  // socket's. The services throttle per IP, so every visitor must not look like 127.0.0.1.
  const peer = req.socket.remoteAddress ?? "";
  const local = /^(::1|127\.|::ffff:127\.)/.test(peer);
  const client = (local && String(req.headers["x-forwarded-for"] ?? "").split(",").pop()?.trim()) || peer;
  // The site's own address, so a click between our pages isn't counted as a referral.
  const site = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  const up = request(u, { method: req.method, headers: { ...req.headers, host: u.host, "x-forwarded-for": client, "x-forwarded-host": site } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502, { "content-type": "application/json" }); res.end('{"error":"unavailable"}'); });
  req.pipe(up);
}

// Size and SHA-256 of each installer, for the downloads page (hashed once per file change).
const hashes = new Map();
async function manifest() {
  const dir = join(root, "downloads");
  const out = [];
  for (const name of await readdir(dir).catch(() => [])) {
    if (name === "README.txt") continue;
    const s = await stat(join(dir, name));
    const key = `${name}:${s.size}:${s.mtimeMs}`;
    if (!hashes.has(key)) hashes.set(key, createHash("sha256").update(await readFile(join(dir, name))).digest("hex"));
    out.push({ name, size: s.size, modified: s.mtime, sha256: hashes.get(key) });
  }
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function resolveFile(path) {
  let file = join(root, path);
  const s = await stat(file).catch(() => null);
  if (s?.isDirectory()) return (await stat(join(file, "index.html")).catch(() => null)) ? join(file, "index.html") : null;
  if (s) return file;
  if (!extname(file) && (await stat(file + ".html").catch(() => null))) return file + ".html";
  return null;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const up = upstreams.find(([prefix]) => url.pathname.startsWith(prefix));
    if (up) return proxy(req, res, up[1]);
    // Absolute links (canonical, Open Graph, sitemap) use SITE_URL, or the address the visitor used.
    const site = (process.env.SITE_URL ?? `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`).replace(/\/+$/, "");
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(`User-agent: *\nDisallow: /v1/\nDisallow: /live/\nDisallow: /demo/\nSitemap: ${site}/sitemap.xml\n`);
    }
    if (url.pathname === "/sitemap.xml") {
      const pages = [...(await readdir(root)), ...(await readdir(join(root, "ar"))).map((f) => `ar/${f}`), ...(await readdir(join(root, "blog")).catch(() => [])).map((f) => `blog/${f}`)].filter((f) => f.endsWith(".html") && f !== "venue.html");
      const urls = pages.map((f) => `  <url><loc>${site}/${f.replace(/(^|\/)index\.html$/, "$1")}</loc></url>`).join("\n");
      res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    }
    if (url.pathname === "/status.json") return sendJson(res, 200, monitor.view());
    if (url.pathname === "/ask" && req.method === "POST") {
      const { ask, available } = await import("./assistant.mjs");
      if (!available()) return sendJson(res, 503, { error: "assistant_unavailable" });
      const peer = req.socket.remoteAddress ?? "";
      const ip = (/^(::1|127\.|::ffff:127\.)/.test(peer) && String(req.headers["x-forwarded-for"] ?? "").split(",").pop()?.trim()) || peer;
      if (!mayAsk(ip)) return sendJson(res, 429, { error: "too_many_questions" });
      const body = await readJson(req).catch(() => null);
      const question = typeof body?.question === "string" ? body.question.trim() : "";
      if (question.length < 3 || question.length > 500) return sendJson(res, 400, { error: "bad_question" });
      try {
        return sendJson(res, 200, await ask(new URL(`file://${root.replace(/\\/g, "/")}/`), question));
      } catch (e) {
        console.error("assistant:", e instanceof Error ? e.message : e);
        return sendJson(res, 502, { error: "assistant_failed" });
      }
    }
    if (url.pathname === "/config.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
      return res.end(JSON.stringify({ adminUrl: process.env.ADMIN_URL ?? "http://localhost:3000", assistant: (await import("./assistant.mjs")).available() }));
    }
    if (url.pathname === "/downloads/manifest.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
      return res.end(JSON.stringify(await manifest()));
    }
    // Public venue pages: /v/<venue> is one page that reads the venue from the URL.
    if (/^\/v\/[a-z0-9-]+\/?$/.test(url.pathname)) url.pathname = "/venue.html";
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, "");
    if (path.includes("..") || PRIVATE.test(path)) throw new Error("not served");
    let file = await resolveFile(path);
    // Live admin demo: records created in the demo (a new organization, employee…)
    // have no pre-rendered page; serve the generic "_" page, which reads the id from the URL.
    if (!file && path.replace(/\\/g, "/").startsWith("live/admin/") && UUID.test(path)) file = await resolveFile(path.replace(UUID, "_"));
    // Single-page demos (customer app, Shell): unknown routes go to their index.
    if (!file) for (const spa of ["live/app", "live/shell"]) if (path.replace(/\\/g, "/").startsWith(spa)) file = await resolveFile(`${spa}/index.html`);
    if (!file) {
      if (path.replace(/\\/g, "/").startsWith("live/admin")) file = await resolveFile("live/admin/404.html");
      if (!file) throw new Error("not found");
    }
    let body = await readFile(file);
    const ext = extname(file);
    if (ext === ".html" || ext === ".xml") body = Buffer.from(body.toString("utf8").replaceAll("%SITE%", site));
    const headers = { "content-type": types[ext] ?? "application/octet-stream", "cache-control": /[\\/]live[\\/].*[\\/](_next|assets)[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache" };
    if (compressible.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"])) && body.length > 1024) {
      body = gzipSync(body);
      headers["content-encoding"] = "gzip";
    }
    headers["content-length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => console.log(`ArenaOS website on http://localhost:${port}`));
