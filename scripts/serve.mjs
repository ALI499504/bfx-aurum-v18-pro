// Serves the downloaded site exactly as deployed, with /api proxied to the live backend.
//
//   node scripts/serve.mjs            # http://localhost:4319
//   PORT=8080 node scripts/serve.mjs
//   UPSTREAM=https://... node scripts/serve.mjs
//   SITE_DIR=/tmp/site-build node scripts/serve.mjs   # serve an alternative build
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SITE = process.env.SITE_DIR || join(ROOT, "site");
const PORT = Number(process.env.PORT || 4319);
const UPSTREAM = (process.env.UPSTREAM || "https://preview-chat-78d758a3-2904-47bf-862f-8130a1a76742.space-z.ai").replace(/\/$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname.startsWith("/api/")) {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const up = await fetch(UPSTREAM + url.pathname + url.search, {
        method: req.method,
        headers: { "content-type": req.headers["content-type"] || "application/json", accept: "*/*" },
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      res.writeHead(up.status, {
        "content-type": up.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      });
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream unavailable", detail: String(err.message) }));
    }
    return;
  }

  const pathname = normalize(decodeURIComponent(url.pathname)).replace(/\\/g, "/");
  const file = join(SITE, pathname);
  if (!file.startsWith(SITE)) return res.writeHead(403).end("forbidden");
  try {
    const s = await stat(file);
    if (s.isFile()) {
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "content-length": s.size });
      return createReadStream(file).pipe(res);
    }
  } catch {}
  const index = join(SITE, "index.html");
  const s = await stat(index);
  res.writeHead(200, { "content-type": MIME[".html"], "content-length": s.size });
  createReadStream(index).pipe(res);
}).listen(PORT, () => console.log(`downloaded site -> http://localhost:${PORT}  (api -> ${UPSTREAM})`));
