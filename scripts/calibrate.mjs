import { readFileSync } from "node:fs";

/**
 * Leest `log.md` en rekent de vier constanten terug uit echte laadbeurten.
 *
 * Dit is de tegenhanger van `src/core/charge.ts`: die rekent vooruit met aannames, dit rekent
 * achteruit met metingen. Het importeert die constanten ook echt (uit `out/`, dus na `tsc`), zodat
 * de vergelijking altijd tegen de waarden gaat waar de app mee rekent en niet tegen een kopie.
 */
const { DEFAULT_SETUP, RATED_CURRENT_A, clampCurrent, powerKwAt } = await import("../out/src/core/charge.js");
const { ampsFromNote } = await import("../out/src/core/logline.js");
const { eurPerKm } = await import("../out/src/core/price.js");

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

const KOLOMMEN = 9; // datum, km, start%, eind%, van, tot, kWh, €, opm — het contract met logline.ts

/**
 * De laadstand uit `opm` (`10 A`, zoals de app hem sinds 2026-09-27 schrijft; het formaat staat in
 * `logline.ts`). Een regel zonder stand is van daarvóór en ging op de hoogste — dat is de enige
 * aanname hier, en hij staat in `charge.ts` (RATED_CURRENT_A), niet in dit script. Een stand die de
 * knop niet heeft (`12 A`) wordt niet stil naar 16 geklemd zoals de app doet: de regel wordt
 * overgeslagen, met een waarschuwing, net als een regel met te weinig cellen.
 */
const stand = (opm) => {
  const geschreven = ampsFromNote(opm);
  if (geschreven === null) return RATED_CURRENT_A;
  return clampCurrent(geschreven) === geschreven ? geschreven : null;
};

const alleRegels = readFileSync("log.md", "utf8")
  // Weggecommentarieerde voorbeeldregels beginnen ook met een `|`, en zijn geen sessies.
  .replace(/<!--[\s\S]*?-->/g, "")
  .split("\n")
  .filter((r) => r.trim().startsWith("|"))
  .map((r) => r.split("|").slice(1, -1).map((c) => c.trim()))
  .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[0]));
// ⚠️ Een regel met te weinig cellen wordt niet stil herschikt: een vergeten afsluitende `|` schuift
// `opm` in de €-kolom, en dan valt `elders geladen` weg en telt die rit mee in het verbruik.
for (const c of alleRegels.filter((c) => c.length !== KOLOMMEN)) {
  console.log(`⚠️ ${c[0]}: ${c.length} kolommen, ${KOLOMMEN} verwacht — regel overgeslagen.`);
}
for (const c of alleRegels.filter((c) => c.length === KOLOMMEN && stand(c[8] ?? "") === null)) {
  console.log(`⚠️ ${c[0]}: "${c[8]}" is geen stand van de kabel (CHARGE_CURRENTS_A) — regel overgeslagen.`);
}
const regels = alleRegels.filter((c) => c.length === KOLOMMEN && stand(c[8] ?? "") !== null);

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
console.log(
  "datum       stand  laadtijd  effectief   uit de muur  rendement   verbruik sinds vorige     kosten   per km",
);
console.log("-".repeat(119));

/** Rendement per stand: een 8 A-beurt hoort niet in het gemiddelde van de 16 A-beurten. */
const rendementen = new Map();
const standen = new Set();
const verbruiken = [];
const perKms = [];
let vorige = null;

for (const c of regels) {
  const [datum, km, start, eind, van, tot, kwh, eur, opm = ""] = c;
  const d = { km: nummer(km), start: nummer(start), eind: nummer(eind), kwh: nummer(kwh), eur: nummer(eur) };
  const amps = stand(opm);
  standen.add(amps);
  const min = minuten(van, tot);
  const inAccu = d.start !== null && d.eind !== null ? ((d.eind - d.start) * cap) / 100 : null;

  const effectief = inAccu !== null && min ? inAccu / uur(min) : null;
  const muur = d.kwh !== null && min ? d.kwh / uur(min) : null;
  const rendement = inAccu !== null && d.kwh ? inAccu / d.kwh : null;
  if (rendement !== null) rendementen.set(amps, [...(rendementen.get(amps) ?? []), rendement]);

  // De gemiddelde prijs van deze beurt: wat hij kostte gedeeld door wat er uit de muur kwam
  // *volgens de aanname waarmee de app het bedrag maakte* — Δ% × capaciteit ÷ rendement. Niet door
  // de meterstand: die meet iets anders dan waar het bedrag op gebouwd is, en dan schuift de fout
  // in het laadvermogen de prijs in.
  const aangenomenMuurKwh = inAccu !== null ? inAccu / DEFAULT_SETUP.efficiency : null;
  d.prijs = d.eur !== null && aangenomenMuurKwh ? d.eur / aangenomenMuurKwh : null;

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

  // Kosten per km, gemeten: het gemeten verbruik sinds de vorige beurt tegen de gemiddelde prijs
  // van díe beurt — dezelfde som als de regel "Kosten per km" op het scherm (`eurPerKm`), alleen
  // met het gemeten verbruik in plaats van de constante.
  let perKm = null;
  if (verbruik !== null && vorige.prijs !== null) {
    perKm = eurPerKm(vorige.prijs, verbruik, DEFAULT_SETUP.efficiency);
    if (perKm !== null) perKms.push(perKm);
  }

  console.log(
    `${datum}  ${`${amps} A`.padStart(5)}` +
      `  ${(min ? `${Math.floor(min / 60)}u ${String(min % 60).padStart(2, "0")}m` : "—").padEnd(8)}` +
      `  ${kW(effectief).padStart(10)}` +
      `  ${kW(muur).padStart(11)}` +
      `  ${(rendement === null ? "—" : `${fmt(rendement * 100, 0)}%`).padStart(9)}` +
      `  ${(verbruik === null ? "—" : `${fmt(verbruik, 1)} kWh/100 km`).padStart(20)}` +
      `  ${(d.eur === null ? "—" : `€ ${fmt(d.eur)}`).padStart(9)}` +
      `  ${(perKm === null ? "—" : `${fmt(perKm * 100, 1)} ct`).padStart(7)}`,
  );
  vorige = d;
}

const gemiddelde = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
// Het voorstel voor EFFICIENCY komt alleen uit de beurten op de hoogste stand: daar is het vermogen
// afgelezen en daar rekent de app het rendement bij. Een lagere stand krijgt zijn eigen regel — dat
// getal is het antwoord op "hoeveel slechter is 8 A", en hoort niet in het gemiddelde.
const opHoogste = rendementen.get(RATED_CURRENT_A) ?? [];
const rGem = gemiddelde(opHoogste);
const vGem = gemiddelde(verbruiken);

console.log("\nVoorstel voor src/core/charge.ts:");
const regel = (naam, nu, gemeten, eenheid, aantal, n = 2) =>
  console.log(
    `  ${naam.padEnd(27)} nu ${fmt(nu, n).padStart(6)}${eenheid}` +
      (gemeten === null
        ? "   (nog te weinig gegevens)"
        : `   gemeten ${fmt(gemeten, n).padStart(6)}${eenheid}  uit ${aantal} sessie(s)`),
  );
regel("EFFICIENCY", DEFAULT_SETUP.efficiency, rGem, "", opHoogste.length, 2);
for (const [amps, lijst] of [...rendementen].filter(([a]) => a !== RATED_CURRENT_A).sort((a, b) => a[0] - b[0])) {
  console.log(
    `  ${`  op ${amps} A`.padEnd(27)} nu ${fmt(DEFAULT_SETUP.efficiency).padStart(6)}` +
      `   gemeten ${fmt(gemiddelde(lijst)).padStart(6)}  uit ${lijst.length} sessie(s) — geen constante, de app rekent op elke stand met EFFICIENCY`,
  );
}
regel("CONSUMPTION_KWH_PER_100KM", DEFAULT_SETUP.consumptionKwhPer100Km, vGem, " kWh/100km", verbruiken.length, 1);
console.log(
  "\nHet laadvermogen staat in de kolom 'uit de muur'; vergelijk het met de stand van die regel " +
    `(${[...standen].sort((a, b) => a - b).map((a) => `${a} A → ${fmt(powerKwAt(a), 2)} kW`).join(", ")}). ` +
    `Wijkt de hoogste stand structureel af van ${fmt(DEFAULT_SETUP.powerKw, 1)} kW, pas dan CHARGE_POWER_KW aan; ` +
    "een lagere stand die achterblijft is een slechter rendement op die stand, geen ander vermogen.",
);
const kGem = gemiddelde(perKms);
if (kGem !== null) {
  console.log(
    `Gemeten kosten: ${fmt(kGem * 100, 1)} ct/km over ${perKms.length} rit(ten) — het scherm rekent met ` +
      `${fmt(DEFAULT_SETUP.consumptionKwhPer100Km, 1)} kWh/100 km en ${fmt(DEFAULT_SETUP.efficiency)} rendement.`,
  );
}
