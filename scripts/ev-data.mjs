// Ververst src/core/evtable.ts uit open-ev-data (MIT, https://github.com/OpenChargingCloud/open-ev-data).
//
//   node scripts/ev-data.mjs [pad/naar/ev-data.json]
//
// Zonder argument wordt het bestand van GitHub gehaald. De tabel wordt meegebundeld in de app, dus de app zelf
// haalt hem nooit op: alleen jij, als je hem wilt verversen. Alleen wat de schatting nodig heeft blijft over:
// bruikbare accu (kWh), verbruik in de praktijk (kWh/100 km) en het vermogen van de boordlader (kW).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_RAW = "https://raw.githubusercontent.com/OpenChargingCloud/open-ev-data/master/data/ev-data.json";
const out = fileURLToPath(new URL("../src/core/evtable.ts", import.meta.url));

const arg = process.argv[2];
const text = arg ? readFileSync(arg, "utf8") : await (await fetch(URL_RAW)).text();
const json = JSON.parse(text);
const list = Array.isArray(json) ? json : json.data;

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const rows = [];
for (const v of list) {
  const kwh = num(v.usable_battery_size);
  const cons = num(v.energy_consumption?.average_consumption);
  const ac = num(v.ac_charger?.max_power);
  if (typeof v.brand !== "string" || typeof v.model !== "string" || kwh === null || cons === null) continue;
  rows.push([String(v.id ?? `${v.brand}-${v.model}-${v.variant ?? ""}-${v.release_year ?? ""}`), v.brand, v.model, String(v.variant ?? ""), num(v.release_year), kwh, cons, ac]);
}
rows.sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || (a[4] ?? 0) - (b[4] ?? 0) || a[5] - b[5]);

const body = rows.map((r) => "  " + JSON.stringify(r)).join(",\n");
writeFileSync(
  out,
  `// GEGENEREERD door scripts/ev-data.mjs uit open-ev-data (MIT) - niet met de hand bewerken.\n` +
    `// [id, merk, model, uitvoering, jaar, bruikbare accu kWh, verbruik kWh/100 km, boordlader AC kW]\n` +
    `export type EvRow = readonly [string, string, string, string, number | null, number, number, number | null];\n\n` +
    `export const EV_ROWS: readonly EvRow[] = [\n${body},\n];\n`,
);
console.log(`${rows.length} van ${list.length} uitvoeringen -> ${out}`);
