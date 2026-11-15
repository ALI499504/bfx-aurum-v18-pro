// Extracts the single application module (id 52683) out of the Turbopack chunk wrapper,
// so the bot's UI code sits in one plain, editable file instead of a bundle envelope.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const src = await readFile(ROOT + "source-readable/eab0eb96527832df.js", "utf8");
const lines = src.split("\n");

const start = lines.findIndex((l) => /^\s*\(e\) => \{\s*$/.test(l));
if (start === -1) throw new Error("module header not found");

// The module ends with the closing brace line right before the chunk wrapper's "]);"
let end = -1;
for (let i = lines.length - 1; i > start; i--) {
  if (/^\s*\]\);?\s*$/.test(lines[i])) {
    end = i - 1; // the "}," line closing the arrow function
    break;
  }
}
if (end <= start) throw new Error("module end not found");

const body = lines
  .slice(start + 1, end)
  .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
  .join("\n");

const banner = `/**
 * BFX AURUM — application module (Turbopack module id 52683)
 *
 * This is the bot's entire client application, extracted verbatim from
 * eab0eb96527832df.js. Nothing was rewritten: only the Turbopack envelope
 * (globalThis.TURBOPACK.push([...])) and the 2-space wrapper indent were removed.
 *
 * Runtime contracts kept intact:
 *   e.i(id)  – import another Turbopack module (React 43476, ReactDOM 71645, lucide 62646, radix, ...)
 *   e.s(ns)  – export the module's namespace entries
 *   e.v()    – export the module value
 *
 * Module ids referenced by this file are defined in the sibling chunks in this folder.
 */
`;
await mkdir(ROOT + "source-readable/app", { recursive: true });
await writeFile(ROOT + "source-readable/app/app-module.js", banner + body + "\n");
console.log(`module body: ${end - start} lines -> source-readable/app/app-module.js`);
