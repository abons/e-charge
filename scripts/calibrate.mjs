import { readFileSync } from "node:fs";

/**
 * Leest `log.md` en toont wat de app daaruit afleidt: de laadsnelheid per stand en de kilometers per
 * procentpunt — met dezelfde functies als de app (`src/core/derive.ts`, uit `out/` dus na `tsc`),
 * niet met een kopie van de som.
 *
 * Sinds 2026-10-06 rekent de app zonder aannames (zie `design.md`): er zijn geen capaciteit, rendement
 * of verbruik om terug te rekenen. Dit script zegt dus welke beurten meetellen, welke niet en waarom,
 * en of de startwaarden in `derive.ts` nog kloppen met het logboek.
 */
process.env.TZ ??= "Europe/Amsterdam";

const { CHARGE_CURRENTS_A, RATED_CURRENT_A, powerKwAt } = await import("../out/src/core/charge.js");
const {
  START_KM_PER_PP,
  START_RATE_PP_PER_H,
  kmPerPp,
  kmPerPpPairs,
  median,
  rateOf,
  ratePerHour,
  rateSamples,
} = await import("../out/src/core/derive.js");
const { parseLogMd } = await import("../out/src/core/logmd.js");

const { entries, skipped } = parseLogMd(readFileSync("log.md", "utf8"));
for (const s of skipped) console.log(`⚠️ ${s.datum}: ${s.reden} — regel overgeslagen.`);

if (entries.length === 0) {
  console.log("Nog geen sessies in log.md — noteer er één en draai dit opnieuw.");
  process.exit(0);
}

const fmt = (v, n = 1) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(n).replace(".", ","));
const datum = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Waarom een beurt niet meetelt voor de snelheid, in woorden. */
function reden(e) {
  if (e.estimated) return "geschat (niet afgelezen) of elders geladen";
  const pp = e.toPercent - e.fromPercent;
  const uren = (e.endMs - e.startMs) / 3_600_000;
  if (e.toPercent > 98) return "eindigt op 99-100%: de duur is afgekapt";
  if (pp < 10) return "minder dan 10 procentpunt";
  if (uren < 1) return "korter dan een uur";
  if (uren > 12) return "langer dan 12 uur";
  return "";
}

console.log("datum       stand  laadtijd  start% → eind%   procentpunt/uur   meetelt");
console.log("-".repeat(78));
/** Telt de beurt mee? Alleen als zijn snelheid na het venster en het uitschieterfilter overblijft. */
const telt = (e, r) => rateSamples(entries, e.amps ?? RATED_CURRENT_A).includes(r);
for (const e of entries) {
  const amps = e.amps ?? RATED_CURRENT_A;
  const min = Math.round((e.endMs - e.startMs) / 60_000);
  const r = rateOf(e);
  const waarom = r === null ? reden(e) : "";
  console.log(
    `${datum(e.startMs)}  ${`${amps} A`.padStart(5)}` +
      `  ${`${Math.floor(min / 60)}u ${String(min % 60).padStart(2, "0")}m`.padEnd(8)}` +
      `  ${`${e.fromPercent} → ${e.toPercent}`.padEnd(14)}` +
      `  ${fmt(r === null ? (e.toPercent - e.fromPercent) / ((e.endMs - e.startMs) / 3_600_000) : r, 2).padStart(16)}` +
      `   ${r === null ? `nee: ${waarom}` : telt(e, r) ? "ja" : "nee: valt buiten het venster of wijkt ver af"}`,
  );
}

console.log("\nWat de app hieruit afleidt:");
for (const a of CHARGE_CURRENTS_A) {
  const v = ratePerHour(entries, a);
  const bron =
    v.source === "eigen" ? `mediaan van ${v.n} beurten` : v.source === "schaling" ? `geschat uit ${RATED_CURRENT_A} A` : "startwaarde";
  console.log(`  ${`${a} A`.padStart(5)}  ${fmt(v.value, 2)} procentpunt/uur   (${bron}; kabel ${fmt(powerKwAt(a), 2)} kW)`);
}
const km = kmPerPp(entries);
console.log(
  `  bereik  ${fmt(km.value, 2)} km per procentpunt   (${km.source === "eigen" ? `${km.n} geldige paren` : "startwaarde"})`,
);
const paren = kmPerPpPairs(entries);
if (paren.length > 0) {
  console.log(`          paren: ${paren.map((p) => `${p.km} km/${p.pp} pp = ${fmt(p.km / p.pp, 2)}`).join(", ")}`);
}

const hoogste = rateSamples(entries, RATED_CURRENT_A);
console.log("\nStartwaarden in src/core/derive.ts (gelden alleen zolang het logboek te weinig beurten heeft):");
const regel = (naam, nu, gemeten, n) =>
  console.log(
    `  ${naam.padEnd(22)} nu ${fmt(nu, 2).padStart(6)}   ` +
      (Number.isFinite(gemeten) ? `log.md ${fmt(gemeten, 2).padStart(6)}  uit ${n}` : "log.md: nog te weinig gegevens"),
  );
regel("START_RATE_PP_PER_H", START_RATE_PP_PER_H, median(hoogste), `${hoogste.length} beurt(en) op ${RATED_CURRENT_A} A`);
regel("START_KM_PER_PP", START_KM_PER_PP, km.source === "eigen" ? km.value : NaN, `${paren.length} paar/paren`);
const afwijking = (nu, gemeten) => (Number.isFinite(gemeten) ? Math.abs(gemeten - nu) / gemeten : 0);
if (afwijking(START_RATE_PP_PER_H, median(hoogste)) > 0.05 || afwijking(START_KM_PER_PP, km.value) > 0.05) {
  console.log(
    "\n⚠️ log.md wijkt meer dan 5% af van de startwaarden: pas ze aan in src/core/derive.ts en ververs " +
      "daarna de momentopname test/fixtures/log-2026-10-06.md (de test leest die, niet het levende log.md).",
  );
} else {
  console.log("\nDe startwaarden liggen binnen 5% van log.md — niets aan te passen.");
}
