// Rebuilds the exact CSV the bot's UI exports ("تصدير CSV" on the backtest tab)
// from the captured backtest run payload.
//
// Columns/format are taken from the client bundle:
//   id, strategy, dir, session, entryT, exitT, entry, exit, sl, tp, result, pnl
// Times are formatted with Intl ar-SY / Asia/Damascus, money with toFixed(2), BOM prefix.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SESSIONS = { asia: "آسيا", london: "لندن", londonNY: "لندن ونيويورك", ny: "نيويورك" };
const fmtTime = new Intl.DateTimeFormat("ar-SY", {
  timeZone: "Asia/Damascus",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const raw = JSON.parse(await readFile(ROOT + "api/backtest/run-latest.json", "utf8"));
const trades = raw.trades ?? [];
if (!trades.length) throw new Error("no trades in captured backtest payload");

const rows = [
  ["#", "الاستراتيجية", "الاتجاه", "الجلسة", "وقت الدخول", "وقت الخروج", "الدخول", "الخروج", "الوقف", "الهدف", "النتيجة", "PnL$"],
];
for (const t of trades) {
  rows.push([
    String(t.id),
    t.strategy,
    t.dir === "buy" ? "شراء" : "بيع",
    SESSIONS[t.session] ?? t.session,
    fmtTime.format(new Date(t.entryT)),
    fmtTime.format(new Date(t.exitT)),
    t.entry.toFixed(2),
    t.exit.toFixed(2),
    t.sl.toFixed(2),
    t.tp.toFixed(2),
    t.result,
    t.pnl.toFixed(2),
  ]);
}

const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
await writeFile(ROOT + "derived/bfx-backtest-trades.csv", csv);

// Also keep a machine-readable XLSX-free JSON copy of the stats block.
const stats = raw.stats ?? {};
await writeFile(ROOT + "derived/backtest-stats.json", JSON.stringify(stats, null, 2));
console.log(`wrote ${trades.length} trades -> derived/bfx-backtest-trades.csv`);
console.log("stats keys:", Object.keys(stats).length);
