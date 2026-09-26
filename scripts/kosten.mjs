import { readFileSync, writeFileSync } from "node:fs";

/**
 * Vult de `€`-kolom van `log.md` voor laadbeurten van vóór 2026-09-26, toen de app het bedrag nog
 * niet zelf bewaarde — of voor elke regel waar het bedrag om een andere reden ontbreekt.
 *
 * Dezelfde som als de app bij 💾 (`huidigeLaadbeurt` in `src/main.ts`): de kwartierprijzen van
 * EnergyZero (`src/core/price.ts`, dezelfde parser en dezelfde tariefopbouw), tegen het laadvermogen
 * uit `charge.ts`, vanaf het insteken tot het moment dat de auto volgens de rekenkern op `eind%`
 * stond — niet tot het afkoppelen. Alleen een regel waarvan elk kwartier een prijs heeft krijgt een
 * bedrag; anders blijft de cel leeg en zegt het script waarom.
 *
 * ⚠️ Dit script praat met het net, en dat is de tweede plek in deze repo die dat doet (naast
 * `src/prices.ts` in de app). Het draait op jouw machine, niet in de pagina, en het haalt niets
 * anders op dan de prijs. De tijden in `log.md` zijn Amsterdamse klok; op een machine in een andere
 * tijdzone (een CI-runner staat op UTC) zet `TZ` hieronder dat recht.
 *
 * Gebruik: `npm run kosten` schrijft de bedragen in `log.md`; `npm run kosten -- --dry-run` laat
 * alleen zien wat er zou komen.
 */
process.env.TZ ??= "Europe/Amsterdam";

const { DEFAULT_SETUP, estimate } = await import("../out/src/core/charge.js");
const { chargingCost, mergeQuarters, parseEnergyZero } = await import("../out/src/core/price.js");

const dryRun = process.argv.includes("--dry-run");
const KOLOMMEN = 9;
const EUR = 7; // de positie van `€` in het kolomcontract van logline.ts

const nummer = (s) => {
  const t = String(s).trim().replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** `jjjj-mm-dd` + `uu:mm` als lokaal moment; `null` als een van beide onleesbaar is. */
function moment(datum, klok, dagenErbij = 0) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  const k = /^(\d{1,2}):(\d{2})$/.exec(String(klok).trim());
  if (!d || !k) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + dagenErbij, Number(k[1]), Number(k[2])).getTime();
}

const apiDate = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};

/** Eén aanroep per dag: de API geeft de dag ervoor en erna mee, dus een beurt over middernacht past. */
const cache = new Map();
async function prijzenVoor(ms) {
  const dag = apiDate(ms);
  if (!cache.has(dag)) {
    const url =
      "https://public.api.energyzero.nl/public/v1/prices" +
      `?energyType=ENERGY_TYPE_ELECTRICITY&date=${dag}&interval=INTERVAL_QUARTER`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
    cache.set(dag, parseEnergyZero(await resp.json()));
  }
  return cache.get(dag);
}

const bron = readFileSync("log.md", "utf8");
const regels = bron.split("\n");
let gevuld = 0;
let overgeslagen = 0;

for (let i = 0; i < regels.length; i++) {
  const r = regels[i];
  if (!r.trim().startsWith("|")) continue;
  const c = r.split("|").slice(1, -1).map((x) => x.trim());
  if (c.length !== KOLOMMEN || !/^\d{4}-\d{2}-\d{2}$/.test(c[0]) || c[EUR] !== "") continue;

  const [datum, , start, eind, van, tot] = c;
  const from = nummer(start);
  const to = nummer(eind);
  const startMs = moment(datum, van);
  let endMs = moment(datum, tot);
  if (from === null || to === null || startMs === null || endMs === null) {
    console.log(`${datum}: onleesbare regel — overgeslagen.`);
    overgeslagen++;
    continue;
  }
  if (endMs < startMs) endMs = moment(datum, tot, 1); // over middernacht

  // Tot de auto volgens de rekenkern op `eind%` stond, net als de app; en de prijzen van de dag van
  // insteken plus, als de beurt daarbuiten valt, die van de dag van afkoppelen.
  const totMs = Math.min(endMs, startMs + estimate(from, to).minutes * 60_000);
  let kwartieren = await prijzenVoor(startMs);
  if (apiDate(totMs) !== apiDate(startMs)) kwartieren = mergeQuarters(kwartieren, await prijzenVoor(totMs), 0);
  const kosten = chargingCost(startMs, totMs, DEFAULT_SETUP.powerKw, kwartieren);

  if (kosten === null || !kosten.complete) {
    console.log(`${datum}: geen (volledige) prijzen voor ${van}–${tot} — cel blijft leeg.`);
    overgeslagen++;
    continue;
  }
  const bedrag = (Math.round(kosten.eur * 100) / 100).toFixed(2).replace(".", ",");
  c[EUR] = bedrag;
  regels[i] = `| ${c.join(" | ")} |`;
  console.log(
    `${datum}: ${from} → ${to}% van ${van} tot ${tot}: € ${bedrag} ` +
      `(${Math.round(kosten.avgEurPerKwh * 100)} ct/kWh gemiddeld)`,
  );
  gevuld++;
}

if (gevuld === 0) {
  console.log(overgeslagen === 0 ? "Alle regels hebben al een bedrag." : "Niets gevuld.");
} else if (dryRun) {
  console.log(`\n${gevuld} regel(s) zouden een bedrag krijgen (--dry-run, log.md is niet aangepast).`);
} else {
  writeFileSync("log.md", regels.join("\n"));
  console.log(`\n${gevuld} regel(s) gevuld in log.md — kijk de diff na en commit.`);
}
