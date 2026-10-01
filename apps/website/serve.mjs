// Zero-dependency static server for the marketing site: `npm run dev -w @arena/website`.
// Also hosts the live demos built by `npm run build:demos` under /live/.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5180);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
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
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, "");
    if (path.includes("..")) throw new Error("bad path");
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
