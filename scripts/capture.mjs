// Full download of the deployed BFX AURUM bot: every static asset, every HTML route,
// and every API payload the bot serves. Writes a verifiable manifest.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "https://preview-chat-78d758a3-2904-47bf-862f-8130a1a76742.space-z.ai";
const OUT = fileURLToPath(new URL("../", import.meta.url));
const manifest = [];
const seen = new Set();

const TFS = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"];

const STATIC = [
  ["/", "index.html", "html"],
  ["/_next/static/chunks/turbopack-428f962ba93c561d.js"],
  ["/_next/static/chunks/2f236954d6a65e12.js"],
  ["/_next/static/chunks/49849b1b478e6b82.js"],
  ["/_next/static/chunks/771dedee3f5e1621.js"],
  ["/_next/static/chunks/29cc553a73248c69.js"],
  ["/_next/static/chunks/a6dad97d9634a72d.js"],
  ["/_next/static/chunks/eab0eb96527832df.js"],
  ["/_next/static/chunks/2b1e3a695777d8a4.css"],
  ["/_next/static/4d0o6LcPrCZYhqeyr2nTh/_ssgManifest.js"],
];

const API = [
  ["/api/system/health", "system/health.json"],
  ["/api/price", "market/price.json"],
  ["/api/mt5/status", "mt5/status.json"],
  ["/api/mt5/account", "mt5/account.json"],
  ["/api/mt5/tick", "mt5/tick.json"],
  ["/api/settings", "engine/settings.json"],
  ["/api/signals", "engine/signals.json"],
  ["/api/alerts", "engine/alerts.json"],
  ["/api/alerts?limit=40", "engine/alerts-limit40.json"],
  ["/api/automanager", "engine/automanager.json"],
  ["/api/backtest?meta=1", "backtest/meta.json"],
  ["/api/backtest", "backtest/run-latest.json"],
  ["/api/basket", "engine/basket.json"],
  ["/api/tuner", "tuning/tuner.json"],
  ["/api/trainer", "tuning/trainer.json"],
  ["/api/visitors", "system/visitors.json"],
  ["/api/jarvis/auth", "jarvis/auth.json"],
  ["/api/jarvis", "jarvis/chat-state.json"],
  ...TFS.map((tf) => [`/api/chart?tf=${tf}&limit=800`, `market/chart-${tf}.json`]),
  ...TFS.map((tf) => [`/api/forecast?tf=${tf}`, `market/forecast-${tf}.json`]),
];

async function grab(url, rel, kind = "asset", retries = 3) {
  const key = url + "->" + rel;
  if (seen.has(key)) return;
  seen.add(key);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE + url, { headers: { accept: "*/*" }, signal: AbortSignal.timeout(45000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const file = join(OUT, rel);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buf);
      const entry = {
        kind,
        url,
        path: rel,
        status: res.status,
        bytes: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16),
        contentType: res.headers.get("content-type"),
        capturedAt: new Date().toISOString(),
      };
      manifest.push(entry);
      console.log(`${String(res.status).padEnd(4)} ${String(buf.length).padStart(9)}b  ${rel}`);
      return buf;
    } catch (err) {
      if (attempt === retries) {
        manifest.push({ kind, url, path: rel, error: String(err.message) });
        console.log(`FAIL      ${rel}  ${String(err.message).slice(0, 60)}`);
      } else await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}

for (const [url, rel, kind] of STATIC) await grab(url, rel ? `site/${rel}` : `site${url}`, kind || "asset");
for (const [url, rel] of API) await grab(url, `api/${rel}`, "api");

await mkdir(join(OUT, "meta"), { recursive: true });
await writeFile(
  join(OUT, "meta", "manifest.json"),
  JSON.stringify(
    { base: BASE, capturedAt: new Date().toISOString(), assets: manifest.filter((m) => m.kind !== "api"), api: manifest.filter((m) => m.kind === "api") },
    null,
    2,
  ),
);
const total = manifest.filter((m) => m.bytes).reduce((a, b) => a + b.bytes, 0);
console.log(`\nfiles: ${manifest.length}  bytes: ${total}`);
