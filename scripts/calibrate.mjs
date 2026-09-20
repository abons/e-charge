import { readFileSync } from "node:fs";

/**
 * Leest `log.md` en rekent de vier constanten terug uit echte laadbeurten.
 *
 * Dit is de tegenhanger van `src/core/charge.ts`: die rekent vooruit met aannames, dit rekent
 * achteruit met metingen. Het importeert die constanten ook echt (uit `out/`, dus na `tsc`), zodat
 * de vergelijking altijd tegen de waarden gaat waar de app mee rekent en niet tegen een kopie.
 */
const { DEFAULT_SETUP } = await import("../out/src/core/charge.js");

const nummer = (s) => {
  const tekst = String(s).trim().replace(",", ".");
  // ⚠️ Een lege kolom is geen nul. `Number("")` is 0 en eindig, en dan drukte de kolom "uit de muur"
  // 0,00 kW af voor elke regel zonder meterstand — precies zo opgemaakt als een echte meting.
  if (tekst === "") return null;
  const v = Number(tekst);
  return Number.isFinite(v) ? v : null;
};

/** `uu:mm` naar minuten; `tot` vóór `van` betekent over middernacht. */
function minuten(van, tot) {
  const knip = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = knip(van);
  const b = knip(tot);
  if (a === null || b === null) return null;
  return b >= a ? b - a : b + 24 * 60 - a;
}

const regels = readFileSync("log.md", "utf8")
  // Weggecommentarieerde voorbeeldregels beginnen ook met een `|`, en zijn geen sessies.
  .replace(/<!--[\s\S]*?-->/g, "")
  .split("\n")
  .filter((r) => r.trim().startsWith("|"))
  .map((r) => r.split("|").slice(1, -1).map((c) => c.trim()))
  .filter((c) => c.length >= 7 && /^\d{4}-\d{2}-\d{2}$/.test(c[0]));

if (regels.length === 0) {
  console.log("Nog geen sessies in log.md — noteer er één en draai dit opnieuw.");
  process.exit(0);
}

const uur = (m) => m / 60;
const fmt = (v, n = 2) => (v === null ? "—" : v.toFixed(n).replace(".", ","));
// Zonder eenheid als er niets staat: "— kW" leest als een vermogen dat gemeten is en nul bleek.
const kW = (v) => (v === null ? "—" : `${fmt(v)} kW`);
const cap = DEFAULT_SETUP.capacityKwh;

console.log(`Gerekend met ${fmt(cap, 1)} kWh bruikbaar (USABLE_CAPACITY_KWH).\n`);
console.log("datum        laadtijd  effectief   uit de muur  rendement   verbruik sinds vorige");
console.log("-".repeat(86));

const rendementen = [];
const verbruiken = [];
let vorige = null;

for (const c of regels) {
  const [datum, km, start, eind, van, tot, kwh, opm = ""] = c;
  const d = { km: nummer(km), start: nummer(start), eind: nummer(eind), kwh: nummer(kwh) };
  const min = minuten(van, tot);
  const inAccu = d.start !== null && d.eind !== null ? ((d.eind - d.start) * cap) / 100 : null;

  const effectief = inAccu !== null && min ? inAccu / uur(min) : null;
  const muur = d.kwh !== null && min ? d.kwh / uur(min) : null;
  const rendement = inAccu !== null && d.kwh ? inAccu / d.kwh : null;
  if (rendement !== null) rendementen.push(rendement);

  // Verbruik: wat er tussen de vorige afkoppeling en deze insteek uit de accu ging, over de
  // gereden kilometers. Slaat over bij een tussentijdse laadbeurt elders — dan klopt de aanname niet.
  let verbruik = null;
  if (vorige && d.km !== null && vorige.km !== null && d.start !== null && vorige.eind !== null) {
    const gereden = d.km - vorige.km;
    const gebruikt = ((vorige.eind - d.start) * cap) / 100;
    if (gereden > 0 && gebruikt > 0 && !/elders/i.test(opm)) {
      verbruik = (gebruikt / gereden) * 100;
      verbruiken.push(verbruik);
    }
  }

  console.log(
    `${datum}   ${(min ? `${Math.floor(min / 60)}u ${String(min % 60).padStart(2, "0")}m` : "—").padEnd(8)}` +
      `  ${kW(effectief).padStart(10)}` +
      `  ${kW(muur).padStart(11)}` +
      `  ${(rendement === null ? "—" : `${fmt(rendement * 100, 0)}%`).padStart(9)}` +
      `  ${(verbruik === null ? "—" : `${fmt(verbruik, 1)} kWh/100 km`).padStart(20)}`,
  );
  vorige = d;
}

const gemiddelde = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const rGem = gemiddelde(rendementen);
const vGem = gemiddelde(verbruiken);

console.log("\nVoorstel voor src/core/charge.ts:");
const regel = (naam, nu, gemeten, eenheid, n = 2) =>
  console.log(
    `  ${naam.padEnd(27)} nu ${fmt(nu, n).padStart(6)}${eenheid}` +
      (gemeten === null
        ? "   (nog te weinig gegevens)"
        : `   gemeten ${fmt(gemeten, n).padStart(6)}${eenheid}  uit ${
            naam === "EFFICIENCY" ? rendementen.length : verbruiken.length
          } sessie(s)`),
  );
regel("EFFICIENCY", DEFAULT_SETUP.efficiency, rGem, "", 2);
regel("CONSUMPTION_KWH_PER_100KM", DEFAULT_SETUP.consumptionKwhPer100Km, vGem, " kWh/100km", 1);
console.log(
  "\nHet laadvermogen staat in de kolom 'uit de muur'; wijkt die structureel af van " +
    `${fmt(DEFAULT_SETUP.powerKw, 1)} kW, pas dan CHARGE_POWER_KW aan.`,
);
