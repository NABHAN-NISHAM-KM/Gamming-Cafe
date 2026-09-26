// Zero-dependency static server for the marketing site: `npm run dev -w @arena/website`.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5180);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([\\/])+/, "");
    if (path.includes("..")) throw new Error("bad path");
    let file = join(root, path);
    const s = await stat(file).catch(() => null);
    if (s?.isDirectory()) file = join(file, "index.html");
    else if (!s && !extname(file)) file += ".html";
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => console.log(`ArenaOS website on http://localhost:${port}`));
