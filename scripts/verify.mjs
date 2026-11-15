// Verifies the archive against meta/manifest.json (size + sha256 prefix for every file).
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const m = JSON.parse(await readFile(ROOT + "meta/manifest.json", "utf8"));
const entries = [...m.assets, ...m.api];

let ok = 0;
const bad = [];
for (const e of entries) {
  try {
    const buf = await readFile(ROOT + e.path);
    const sha = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    if (sha === e.sha256 && buf.length === e.bytes) ok++;
    else bad.push(`${e.path} (size ${buf.length}/${e.bytes}, sha ${sha}/${e.sha256})`);
  } catch (err) {
    bad.push(`${e.path} missing`);
  }
}

const site = await stat(ROOT + "site/_next/static/chunks/eab0eb96527832df.js");
console.log(`manifest entries: ${entries.length}  verified: ${ok}  failed: ${bad.length}`);
if (bad.length) console.log(bad.join("\n"));
console.log(`app bundle: ${site.size} bytes`);
process.exitCode = bad.length ? 1 : 0;
