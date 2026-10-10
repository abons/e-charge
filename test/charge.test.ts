import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CHARGE_CURRENTS_A,
  RATED_CURRENT_A,
  clampCurrent,
  clampPercent,
  estimate,
  maxMeterKwh,
  percentAfter,
  powerKwAt,
  rangeKm,
  type Setup,
} from "../src/core/charge.js";
import {
  MIN_PAIRS,
  START_KM_PER_PP,
  START_RATE_PP_PER_H,
  WINDOW,
  kmPerPp,
  kmPerPpPairs,
  median,
  rateOf,
  ratePerHour,
  rateSamples,
  setupAt,
} from "../src/core/derive.js";
import { usageChart } from "../src/core/usagechart.js";
import { calendar } from "../src/core/ics.js";
import { ampsFromNote, isUnreliableNote, logRow, noteFor, noteForAmps } from "../src/core/logline.js";
import { parseLogMd } from "../src/core/logmd.js";
import {
  manualEntry,
  parseEntries,
  toMarkdown,
  updatableFinished,
  withEntry,
  withMeterAsPercent,
  withoutEntry,
  type Entry,
} from "../src/core/logbook.js";
import { clock, dayLabel, dayOffset, duration, number as nl } from "../src/core/time.js";

/** De rekenkern en de weergave. Eén laadsessie is niet te controleren met een debugger, dus hier. */

const HOUR = 3_600_000;

/** Een vaste opzet voor de rekenkern: 10 procentpunt per uur, 3,5 kW uit de muur, 2 km per procentpunt. */
const S: Setup = { ratePpPerHour: 10, powerKw: 3.5, kmPerPp: 2 };

/** Een afgelezen beurt op de hoogste stand: [dag] van september 2026, 11:00, [uren] lang. */
function sessie(dag: number, from: number, to: number, uren: number, extra: Partial<Entry> = {}): Entry {
  const startMs = new Date(2026, 8, dag, 11, 0).getTime();
  return {
    startMs,
    endMs: startMs + uren * HOUR,
    fromPercent: from,
    toPercent: to,
    km: null,
    kwh: null,
    eur: null,
    amps: 16,
    estimated: false,
    ...extra,
  };
}

test("laadstanden: de hoogste stand is het afgelezen vermogen, de rest schaalt mee", () => {
  assert.equal(CHARGE_CURRENTS_A.at(-1), RATED_CURRENT_A);
  assert.ok(CHARGE_CURRENTS_A.every((a, i) => i === 0 || a > (CHARGE_CURRENTS_A[i - 1] ?? 0)), "oplopend");
  assert.equal(powerKwAt(RATED_CURRENT_A), 3.5);
  // 8 A is de helft van 16 A: 1,75 kW uit de muur.
  assert.equal(powerKwAt(8).toFixed(3), "1.750");
  assert.equal(powerKwAt(10).toFixed(3), "2.188");
  // Een stand die de knop niet heeft, is de hoogste — wat er in opslag staat is niet te vertrouwen.
  assert.equal(clampCurrent(9), RATED_CURRENT_A);
  assert.equal(clampCurrent("10"), RATED_CURRENT_A);
  assert.equal(clampCurrent(Number.NaN), RATED_CURRENT_A);
  assert.equal(clampCurrent(10), 10);
  assert.equal(powerKwAt(999), 3.5);
});

test("estimate: de laadtijd komt uit procentpunt per uur", () => {
  // 47 procentpunt aan 10 per uur is 4,7 uur: 282 minuten.
  const e = estimate(43, 90, S);
  assert.equal(e.needed, true);
  assert.equal(e.minutes, 282);
  // Half zo snel, dubbel zo lang.
  assert.equal(estimate(43, 90, { ...S, ratePpPerHour: 5 }).minutes, 564);
});

test("estimate: doel al gehaald betekent niet laden", () => {
  assert.deepEqual(estimate(90, 90, S), { needed: false, minutes: 0 });
  assert.deepEqual(estimate(95, 90, S), { needed: false, minutes: 0 });
  // Zonder snelheid valt er niets te rekenen — geen oneindige laadtijd.
  assert.deepEqual(estimate(10, 90, { ...S, ratePpPerHour: 0 }), { needed: false, minutes: 0 });
  assert.deepEqual(estimate(10, 90, { ...S, ratePpPerHour: Number.NaN }), { needed: false, minutes: 0 });
});

test("estimate: rondt minuten naar boven en klemt percentages", () => {
  // 1 procentpunt aan 7 per uur is 8,57 minuten: 9, niet 8.
  assert.equal(estimate(50, 51, { ...S, ratePpPerHour: 7 }).minutes, 9);
  assert.equal(estimate(-20, 150, S).minutes, 600); // 0 → 100
  assert.equal(estimate(Number.NaN, 90, S).minutes, 540);
});

test("maxMeterKwh: een percentage is geen meterstand", () => {
  const nacht = 7 * HOUR;
  // Wat de lader er in zeven uur doorheen krijgt is 24,5 kWh; de grens laat ruimte voor het huis.
  assert.equal(maxMeterKwh(nacht).toFixed(2), "36.75");
  assert.ok(20.4 <= maxMeterKwh(nacht), "een echte meterstand hoort er ruim onder te blijven");
  assert.ok(97 > maxMeterKwh(nacht), "97 procent hoort tegen de grens te lopen");
  // Pas na bijna een etmaal aan de muur zou 97 kWh kunnen kloppen, en dan is het ook geen vergissing meer.
  assert.ok(97 > maxMeterKwh(18 * HOUR));
  assert.ok(97 < maxMeterKwh(20 * HOUR));
  // Onzin levert geen negatieve grens op, en zonder tijd past er niets.
  assert.equal(maxMeterKwh(0), 0);
  assert.equal(maxMeterKwh(-HOUR), 0);
});

test("rangeKm: procenten naar kilometers, naar beneden afgerond", () => {
  assert.equal(rangeKm(90, S), 180);
  assert.equal(rangeKm(100, S), 200);
  assert.equal(rangeKm(0, S), 0);
  assert.equal(rangeKm(43, { ...S, kmPerPp: 2.01 }), 86); // 86,43
  assert.equal(rangeKm(150, S), 200); // klemt op 100%
});

test("rangeKm: een gebroken percentage gaat naar beneden, niet naar het dichtstbijzijnde", () => {
  // Het scherm toont Math.floor(soc): 59,7% heet 59%, en dan horen de kilometers van 59 erbij.
  assert.equal(rangeKm(59.7, S), 118);
  assert.equal(rangeKm(59.7, S), rangeKm(59, S));
});

test("percentAfter: loopt op met de snelheid en stopt pas op 100%", () => {
  assert.equal(percentAfter(43, 90, HOUR, S), 53);
  assert.equal(percentAfter(43, 90, 0, S), 43);
  // Het doel is geen plafond: de auto kent jouw doel niet en laadt door tot 100%.
  assert.equal(percentAfter(43, 90, 5 * HOUR, S), 93);
  assert.equal(percentAfter(43, 90, 20 * HOUR, S), 100);
});

test("percentAfter: onzinnige invoer levert gewoon het startpunt op", () => {
  assert.equal(percentAfter(43, 90, -HOUR, S), 43);
  assert.equal(percentAfter(90, 90, HOUR, S), 90); // niets te laden
  assert.equal(percentAfter(Number.NaN, 90, HOUR, S), 10);
});

test("percentAfter en estimate zijn elkaars omgekeerde", () => {
  // Wat estimate() als laadtijd geeft, moet percentAfter() op het doel uitbrengen — anders zou de
  // aftelling op het scherm iets anders zeggen dan de eindtijd erboven. Het scherm toont
  // `Math.floor(soc)`, dus gelijk tot op de hele procent is wat er te controleren valt.
  const snelheden = [10.1, 7, 5.05, 11.04];
  for (const ratePpPerHour of snelheden) {
    for (const [from, to] of [[10, 80], [43, 90], [0, 100], [65, 66]] as const) {
      const opzet = { ...S, ratePpPerHour };
      const ms = estimate(from, to, opzet).minutes * 60_000;
      const soc = percentAfter(from, to, ms, opzet);
      assert.equal(Math.floor(soc), to, `${ratePpPerHour}: ${from} → ${to}: ${soc}`);
      // Eén minuut eerder is hij er nog net niet (afronden naar boven zit in estimate).
      assert.ok(percentAfter(from, to, ms - 60_000, opzet) < to, `${ratePpPerHour}: ${from} → ${to}`);
    }
  }
});

// --- Wat uit het logboek volgt (derive.ts) -------------------------------------------------------

test("median: het midden, en NaN zonder getallen", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([7]), 7);
  assert.ok(Number.isNaN(median([])));
});

test("rateOf: alleen een afgelezen, niet afgekapte beurt zegt iets over de snelheid", () => {
  assert.equal(rateOf(sessie(1, 40, 90, 5)), 10);
  // Geschat: de eigen schatting bevestigt alleen zichzelf.
  assert.equal(rateOf(sessie(1, 40, 90, 5, { estimated: true })), null);
  // Afgekapt: de lader was eerder klaar dan je afkoppelde.
  assert.equal(rateOf(sessie(1, 40, 100, 5)), null);
  assert.equal(rateOf(sessie(1, 40, 99, 5)), null);
  assert.ok(rateOf(sessie(1, 40, 98, 5)) !== null);
  // Te weinig procentpunt of te kort: te grof; te lang: een vergeten stekker of een tikfout.
  assert.equal(rateOf(sessie(1, 50, 59, 1)), null);
  assert.equal(rateOf(sessie(1, 50, 80, 0.5)), null);
  assert.equal(rateOf(sessie(1, 20, 80, 13)), null);
});

test("ratePerHour: eigen beurten winnen pas vanaf drie, daarvoor de startwaarde", () => {
  const twee = [sessie(1, 40, 90, 5), sessie(2, 40, 90, 5)];
  assert.deepEqual(ratePerHour(twee, 16), { value: START_RATE_PP_PER_H, n: 0, source: "start" });
  assert.deepEqual(ratePerHour([], 16), { value: START_RATE_PP_PER_H, n: 0, source: "start" });
  const drie = [...twee, sessie(3, 40, 90, 4.5)];
  const r = ratePerHour(drie, 16);
  assert.equal(r.source, "eigen");
  assert.equal(r.n, 3);
  assert.equal(r.value, 10); // mediaan van 10, 10 en 11,1
  // Zonder stand in de regel (van vóór de standenkeuze) is het de hoogste.
  assert.equal(ratePerHour(drie.map((e) => ({ ...e, amps: null })), 16).source, "eigen");
});

test("ratePerHour: een lagere stand schaalt met de kabel, tot er eigen beurten op die stand zijn", () => {
  const drie = [sessie(1, 40, 90, 5), sessie(2, 40, 90, 5), sessie(3, 40, 90, 5)];
  const acht = ratePerHour(drie, 8);
  assert.equal(acht.source, "schaling");
  assert.equal(acht.value, 5); // de helft van 10
  assert.equal(acht.n, 3);
  assert.equal(ratePerHour(drie, 10).value, 6.25);
  // Met één eigen beurt op 8 A nog niet; met twee wel.
  const een = [...drie, sessie(4, 40, 70, 10, { amps: 8 })];
  assert.equal(ratePerHour(een, 8).source, "schaling");
  const twee = [...een, sessie(5, 30, 60, 10, { amps: 8 })];
  assert.deepEqual(ratePerHour(twee, 8), { value: 3, n: 2, source: "eigen" });
  // En de hoogste stand blijft onaangetast door beurten op een andere stand.
  assert.equal(ratePerHour(twee, 16).value, 10);
  // Zonder beurten op 16 A schaalt een lagere stand uit de startwaarde.
  assert.equal(ratePerHour([], 8).value, START_RATE_PP_PER_H / 2);
});

test("rateSamples: de laatste acht, en een vergissing valt eruit", () => {
  const veel = Array.from({ length: 12 }, (_, i) => sessie(i + 1, 40, 90, 5 + (i % 2)));
  assert.equal(rateSamples(veel, 16).length, WINDOW);
  // Een beurt die half zo snel ging als de rest is een vergissing in de invoer, geen auto.
  const met = [sessie(1, 40, 90, 5), sessie(2, 40, 90, 5), sessie(3, 40, 90, 5), sessie(4, 40, 90, 12)];
  assert.deepEqual(rateSamples(met, 16), [10, 10, 10]);
});

test("kmPerPp: opeenvolgende regels, gepoold, met een rit die er ver naast zit weggelaten", () => {
  // km-stand bij insteken; eind% van de ene en start% van de volgende zeggen wat er is verbruikt.
  const lijst: Entry[] = [
    sessie(1, 50, 90, 4, { km: 1000 }),
    sessie(3, 50, 90, 4, { km: 1080 }), // 80 km voor 40 procentpunt: 2,0
    sessie(5, 50, 90, 4, { km: 1160 }), // 2,0
    sessie(7, 50, 90, 4, { km: 1244 }), // 84 km voor 40: 2,1
    sessie(9, 60, 90, 4, { km: 1330 }), // 86 km voor 30: 2,87 — te ver af
  ];
  assert.equal(kmPerPpPairs(lijst).length, 3); // het vierde paar valt buiten 1,35 keer de mediaan
  const v = kmPerPp(lijst);
  assert.equal(v.source, "eigen");
  // 3 paren blijven over: (80 + 80 + 84) ÷ (40 + 40 + 40)
  assert.equal(v.n, 3);
  assert.ok(Math.abs(v.value - 244 / 120) < 1e-9, String(v.value));
});

test("kmPerPp: te weinig paren, een geschatte regel en een km-sprong tellen niet", () => {
  assert.deepEqual(kmPerPp([]), { value: START_KM_PER_PP, n: 0, source: "start" });
  const twee: Entry[] = [
    sessie(1, 50, 90, 4, { km: 1000 }),
    sessie(3, 50, 90, 4, { km: 1080 }),
    sessie(5, 50, 90, 4, { km: 1160 }),
  ];
  assert.equal(kmPerPp(twee).source, "start"); // 2 paren < MIN_PAIRS
  assert.ok(MIN_PAIRS > 2);
  const geschat = [...twee, sessie(7, 50, 90, 4, { km: 1240 }, )];
  assert.equal(kmPerPp(geschat).source, "eigen");
  // Is een eind% geschat, dan zegt het paar met de volgende regel niets.
  const nep = geschat.map((e, i) => (i === 1 ? { ...e, estimated: true } : e));
  assert.equal(kmPerPpPairs(nep).length, 1);
  // Terugdraaiende km-stand, of te weinig procentpunt: geen paar. Meer dan een week ertussen ook niet.
  const kapot: Entry[] = [sessie(1, 50, 90, 4, { km: 1000 }), sessie(2, 50, 90, 4, { km: 990 })];
  assert.equal(kmPerPpPairs(kapot).length, 0);
  const zonderKm: Entry[] = [sessie(1, 50, 90, 4), sessie(3, 50, 90, 4, { km: 1080 })];
  assert.equal(kmPerPpPairs(zonderKm).length, 0);
  const lang: Entry[] = [sessie(1, 50, 90, 4, { km: 1000 }), sessie(20, 50, 90, 4, { km: 1080 })];
  assert.equal(kmPerPpPairs(lang).length, 0);
});

test("setupAt: snelheid, kabelvermogen en kilometers per procentpunt op één stand", () => {
  const s = setupAt(8, []);
  assert.equal(s.ratePpPerHour, START_RATE_PP_PER_H / 2);
  assert.equal(s.powerKw, powerKwAt(8));
  assert.equal(s.kmPerPp, START_KM_PER_PP);
  // De kWh uit de muur per procentpunt blijft op elke stand gelijk: halve snelheid, half vermogen.
  assert.ok(Math.abs(s.powerKw / s.ratePpPerHour - setupAt(16, []).powerKw / setupAt(16, []).ratePpPerHour) < 1e-9);
});

test("startwaarden: staan op wat dezelfde afleiding uit de momentopname van log.md haalt", () => {
  const { entries, skipped } = parseLogMd(readFileSync("test/fixtures/log-2026-10-06.md", "utf8"));
  assert.deepEqual(skipped, []);
  assert.ok(entries.length >= 7, "log.md hoort zijn beurten te hebben");
  const snelheid = median(rateSamples(entries, RATED_CURRENT_A));
  assert.ok(Math.abs(snelheid - START_RATE_PP_PER_H) / snelheid < 0.05, `log.md ${snelheid}, startwaarde ${START_RATE_PP_PER_H}`);
  const km = kmPerPp(entries);
  assert.equal(km.source, "eigen");
  assert.ok(Math.abs(km.value - START_KM_PER_PP) / km.value < 0.02, `log.md ${km.value}, startwaarde ${START_KM_PER_PP}`);
  // De geschatte beurten (27 sep, 2 okt) zitten er niet in.
  assert.ok(entries.some((e) => e.estimated === true));
  assert.ok(rateSamples(entries, RATED_CURRENT_A).every((r) => r > 9 && r < 12));
});

test("zelfvoeding: een logboek met alleen geschatte beurten geeft de startwaarden", () => {
  // Wat de app zelf uitrekende en als eind% bewaarde, mag de snelheid niet bevestigen.
  const eigenSchatting = [1, 2, 3, 4, 5].map((d) =>
    sessie(d, 40, 90, 3, { estimated: true, km: 1000 + d * 80 }),
  );
  assert.equal(ratePerHour(eigenSchatting, 16).source, "start");
  assert.equal(kmPerPp(eigenSchatting).source, "start");
  assert.equal(setupAt(16, eigenSchatting).ratePpPerHour, START_RATE_PP_PER_H);
});

test("parseLogMd: de tabel als regels, met herkomst en over middernacht", () => {
  const tekst = [
    "| datum | km | start% | eind% | van | tot | kWh | € | opm |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| 2026-09-13 | 96839 | 74 | 97 | 13:52 | 16:13 |  | 2,54 |  |",
    "| 2026-09-27 | 97195 | 65 | 85 | 22:00 | 02:00 |  | 1,06 | 16 A; eind% en km geschat |",
    "| 2026-09-28 | 97200 | 50 | 60 | 10:00 | 12:00 |  |  | 12 A |",
    "| 2026-09-29 | 97200 | 50 | 60 | 10:00 |",
    "<!-- | 2026-09-30 | 1 | 1 | 1 | 10:00 | 11:00 |  |  |  | -->",
  ].join("\n");
  const { entries, skipped } = parseLogMd(tekst);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.eur, 2.54);
  assert.equal(entries[0]?.amps, null);
  assert.equal(entries[0]?.estimated, false);
  assert.equal(entries[1]?.amps, 16);
  assert.equal(entries[1]?.estimated, true);
  assert.equal((entries[1]!.endMs - entries[1]!.startMs) / HOUR, 4); // 22:00 → 02:00
  // Een stand die de knop niet heeft en een regel met te weinig cellen worden gemeld, niet geraden.
  assert.deepEqual(skipped.map((s) => s.datum), ["2026-09-28", "2026-09-29"]);
});

test("noteFor en isUnreliableNote: de stand en 'geschat' in de opm-kolom", () => {
  assert.equal(noteFor(16, false), "16 A");
  assert.equal(noteFor(16, true), "16 A; geschat");
  assert.equal(noteFor(null, true), "geschat");
  assert.equal(noteFor(null, false), undefined);
  assert.equal(ampsFromNote("16 A; geschat"), 16); // de stand blijft leesbaar
  assert.equal(isUnreliableNote("16 A; eind% en km geschat (hersteld)"), true);
  assert.equal(isUnreliableNote("elders geladen"), true);
  assert.equal(isUnreliableNote("16 A"), false);
  assert.equal(isUnreliableNote(""), false);
});

test("clampPercent: hele getallen, 0 t/m 100", () => {
  assert.equal(clampPercent(43.4), 43);
  assert.equal(clampPercent(-1), 0);
  assert.equal(clampPercent(101), 100);
  assert.equal(clampPercent(Number.NaN), 0);
});

test("duration: uren en minuten, minuten alleen als het korter is", () => {
  assert.equal(duration(544), "9u 04m");
  assert.equal(duration(515), "8u 35m");
  assert.equal(duration(60), "1u 00m");
  assert.equal(duration(35), "35m");
  assert.equal(duration(0), "0m");
});

test("clock en getalweergave zijn lokaal en Nederlands", () => {
  const t = new Date(2026, 8, 11, 10, 35).getTime();
  assert.equal(clock(t), "10:35");
  assert.equal(clock(t + 8 * 3_600_000 + 35 * 60_000), "19:10");
  assert.equal(nl(2.024), "2,0");
  assert.equal(nl(18.333, 2), "18,33");
});

test("dayLabel: 'morgen' zodra de eindtijd over middernacht schuift", () => {
  const avond = new Date(2026, 8, 11, 22, 0).getTime();
  assert.equal(dayLabel(avond, avond + 60 * 60_000), null); // 23:00, zelfde dag
  assert.equal(dayLabel(avond, avond + 3 * 60 * 60_000), "morgen"); // 01:00
  assert.equal(dayOffset(avond, avond + 3 * 60 * 60_000), 1);
  assert.equal(dayLabel(avond, avond + 27 * 60 * 60_000), "overmorgen");
  assert.equal(dayLabel(avond, avond + 51 * 60 * 60_000), "maandag");
});

test("calendar: één afspraak op de eindtijd, met melding", () => {
  const readyMs = Date.UTC(2026, 8, 11, 17, 10);
  const ics = calendar({ readyMs, title: "Leaf 90% — klaar", description: "Test" }, Date.UTC(2026, 8, 11, 8, 35));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(ics, /\r\nDTSTART:20260911T171000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20260911T172500Z\r\n/); // standaard een kwartier
  assert.match(ics, /\r\nDTSTAMP:20260911T083500Z\r\n/);
  assert.match(ics, /\r\nBEGIN:VALARM\r\n[\s\S]*TRIGGER:PT0S\r\n[\s\S]*END:VALARM\r\n/);
});

test("calendar: tekstvelden worden ontsnapt en lange regels gevouwen", () => {
  const ics = calendar({
    readyMs: Date.UTC(2026, 8, 11, 17, 10),
    title: "Leaf; 90%, klaar",
    description: "Regel een\nregel twee met een heel lange staart die ruim over de vijfenzeventig octetten heen loopt",
  });
  // Losse backslashes in een regex lezen slecht; hier is een string duidelijker over wat er staat.
  assert.ok(ics.includes("SUMMARY:Leaf\\; 90%\\, klaar"));
  assert.ok(ics.includes("DESCRIPTION:Regel een\\nregel twee"));
  for (const line of ics.split("\r\n")) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `te lang: ${line}`);
  }
});

// Deze stond er niet, en daardoor kon de tekenklasse maandenlang `[\;,]` in plaats van `[\\;,]`
// zijn: `;` en `,` werden ontsnapt, een backslash niet — en dat geeft een ongeldig tekstveld.
test("calendar: een backslash in de tekst wordt verdubbeld", () => {
  const ics = calendar({
    readyMs: Date.UTC(2026, 8, 11, 17, 10),
    title: "Pad C:\\laden",
    description: "een\\twee",
  });
  assert.ok(ics.includes("SUMMARY:Pad C:\\\\laden"), ics);
  assert.ok(ics.includes("DESCRIPTION:een\\\\twee"), ics);
});

// De kolomvolgorde is een contract met scripts/calibrate.mjs, dat op positie leest en niet op naam.
test("logRow: de kolommen van log.md, in die volgorde", () => {
  const start = new Date(2026, 8, 12, 22, 10).getTime();
  const eind = new Date(2026, 8, 13, 5, 5).getTime(); // over middernacht
  assert.equal(
    logRow({ startMs: start, endMs: eind, fromPercent: 43, toPercent: 90, km: 84210, kwh: 20.4, eur: 3.3 }),
    "| 2026-09-12 | 84210 | 43 | 90 | 22:10 | 05:05 | 20,4 | 3,30 |  |",
  );
  // De datum is die van het insteken, ook als het afkoppelen de volgende dag is.
  assert.ok(logRow({ startMs: start, endMs: eind, fromPercent: 43, toPercent: 90 }).startsWith("| 2026-09-12 |"));
});

test("logRow: lege kolommen blijven leeg, percentages worden heel", () => {
  const start = new Date(2026, 8, 12, 9, 0).getTime();
  assert.equal(
    logRow({ startMs: start, endMs: start + 3_600_000, fromPercent: 43.4, toPercent: 89.6 }),
    "| 2026-09-12 |  | 43 | 90 | 09:00 | 10:00 |  |  |  |",
  );
});

const beurt = (dag: number, van = 43, tot = 90) => ({
  startMs: new Date(2026, 8, dag, 22, 10).getTime(),
  endMs: new Date(2026, 8, dag + 1, 5, 5).getTime(),
  fromPercent: van,
  toPercent: tot,
  km: 84210 + dag,
  kwh: null,
  eur: null,
  amps: null,
});

test("logbook: wat uit opslag komt wordt niet vertrouwd", () => {
  assert.deepEqual(parseEntries(null), []);
  assert.deepEqual(parseEntries("geen json"), []);
  assert.deepEqual(parseEntries('{"geen": "lijst"}'), []);
  // Regels zonder bruikbare tijden of percentages vallen weg in plaats van het scherm mee te slepen.
  assert.deepEqual(parseEntries('[{"startMs": 1, "endMs": 0, "fromPercent": 1, "toPercent": 2}]'), []);
  assert.deepEqual(parseEntries('[{"startMs": "gisteren"}, null, 3]'), []);
  const goed = parseEntries(JSON.stringify([beurt(12)]));
  assert.equal(goed.length, 1);
  assert.equal(goed[0]?.km, 84222);
});

test("logbook: dezelfde laadbeurt tweemaal bewaren geeft één regel", () => {
  const een = withEntry([], beurt(12));
  const nogmaals = withEntry(een, { ...beurt(12), kwh: 20.4 });
  assert.equal(nogmaals.length, 1);
  assert.equal(nogmaals[0]?.kwh, 20.4); // de nieuwste wint, zodat je later de meterstand kunt aanvullen
});

// De beloofde route: 's avonds bewaren mét km-stand, 's ochtends de meterstand erbij — en dan zijn
// de invoervelden leeg. Een lege waarde mag dus niet over een ingevulde heen.
test("logbook: aanvullen wist niet wat er al stond", () => {
  const avond = withEntry([], { ...beurt(12), km: 84210, kwh: null });
  const ochtend = withEntry(avond, { ...beurt(12), km: null, kwh: 20.4 });
  assert.equal(ochtend.length, 1);
  assert.equal(ochtend[0]?.km, 84210);
  assert.equal(ochtend[0]?.kwh, 20.4);
  // En andersom net zo.
  const later = withEntry(ochtend, { ...beurt(12), km: null, kwh: null });
  assert.equal(later[0]?.km, 84210);
  assert.equal(later[0]?.kwh, 20.4);
});

// De aanleiding staat in design.md: het veld vroeg om kWh van de meter, en wie die niet heeft vult
// in wat hij wél heeft — het percentage van het dashboard.
test("logbook: een meterstand die geen kWh kan zijn, was een aflezing", () => {
  const met = (kwh: number | null) => [{ ...beurt(12), kwh }];
  // 97 kWh kan er in zeven uur niet doorheen; als percentage kan het wel, dus het wordt eind%.
  const verhuisd = withMeterAsPercent(met(97));
  assert.equal(verhuisd[0]?.toPercent, 97);
  assert.equal(verhuisd[0]?.kwh, null);
  assert.equal(verhuisd[0]?.fromPercent, 43); // de rest van de regel blijft staan
  assert.equal(verhuisd[0]?.km, 84222);
  // Een echte meterstand blijft met rust gelaten, en een lege kolom ook.
  assert.deepEqual(withMeterAsPercent(met(20.4)), met(20.4));
  assert.deepEqual(withMeterAsPercent(met(null)), met(null));
  // Wat geen van beide kan zijn, blijft staan: raden is hier erger dan laten staan.
  assert.deepEqual(withMeterAsPercent(met(300)), met(300));
  // En een getal onder het startpercentage is geen eind% — de auto laadt niet achteruit.
  assert.deepEqual(withMeterAsPercent(met(40)), met(40));
});

test("logbook: de kosten reizen mee, en een beurt zonder prijzen wist ze niet", () => {
  // Tijdens het laden bewaard zonder prijzen, na het afkoppelen mét: de nieuwste wint.
  const zonder = withEntry([], { ...beurt(12), eur: null });
  const met = withEntry(zonder, { ...beurt(12), eur: 3.3 });
  assert.equal(met[0]?.eur, 3.3);
  // Later nog eens bewaren (km-stand erbij) als de prijzen uit opslag zijn: het bedrag blijft.
  const later = withEntry(met, { ...beurt(12), km: 84300, eur: null });
  assert.equal(later[0]?.eur, 3.3);
  assert.equal(later[0]?.km, 84300);
  // Maar een beurt die langer bleek (ander einde) zonder prijzen: het tussentijdse bedrag hoort er
  // niet bij en verdwijnt — anders leest calibrate € 3,30 naast een nacht van tien uur.
  const langer = withEntry(met, { ...beurt(12), endMs: beurt(12).endMs + 3_600_000, eur: null });
  assert.equal(langer[0]?.eur, null);
  // Uit opslag: een oude regel zonder `eur` leest als null, geen 0.
  assert.equal(parseEntries(JSON.stringify([{ ...beurt(12), eur: undefined }]))[0]?.eur, null);
  assert.ok(toMarkdown(met).includes("| 3,30 |"));
});

// Het formaat van de stand in de opm-kolom is een contract tussen de app (schrijver) en de twee
// scripts (lezers), net als de kolomvolgorde — dus rond, in één paar, met een test.
test("logline: noteForAmps en ampsFromNote zijn elkaars omgekeerde", () => {
  for (const amps of CHARGE_CURRENTS_A) assert.equal(ampsFromNote(noteForAmps(amps)), amps);
  assert.equal(noteForAmps(10), "10 A");
  assert.equal(noteForAmps(9), `${RATED_CURRENT_A} A`); // de schrijver klemt, net als de app
  // De lezer klemt níét: een stand die de knop niet heeft moet de scripts opvallen, niet stil 16 worden.
  assert.equal(ampsFromNote("12 A"), 12);
  assert.equal(ampsFromNote("12.5 A"), 12.5); // en niet 5
  assert.equal(ampsFromNote("12,5 A"), 12.5);
  // Zonder stand is het `null` — een regel van vóór de standenkeuze, of alleen een opmerking.
  assert.equal(ampsFromNote(""), null);
  assert.equal(ampsFromNote("elders geladen"), null);
  assert.equal(ampsFromNote("vorst, 10 A"), 10);
  assert.equal(ampsFromNote("10A"), 10);
  assert.equal(ampsFromNote("10 Ah"), null); // een hele-woord-grens: `Ah` is geen stand
});

// De stand gaat als `16 A` de opm-kolom in: geen eigen kolom, want de kolomvolgorde is een contract
// met calibrate — en die leest hem daar via `ampsFromNote` weer uit.
test("logbook: de laadstand reist mee en komt als opmerking in de regel", () => {
  const op10 = withEntry([], { ...beurt(12), amps: 10 });
  assert.equal(op10[0]?.amps, 10);
  assert.ok(toMarkdown(op10).endsWith("|  |  | 10 A |"), toMarkdown(op10));
  // Een oude regel zonder stand blijft leeg in opm — die ging op de hoogste stand, maar dat raden we niet.
  assert.equal(toMarkdown([beurt(12)]).endsWith("|  |  |  |"), true);
  assert.equal(parseEntries(JSON.stringify([beurt(12)]))[0]?.amps, null);
  assert.equal(parseEntries(JSON.stringify([{ ...beurt(12), amps: 8 }]))[0]?.amps, 8);
  // Uit opslag wordt geklemd, net als de sessie: een bewerkte 12.5 wordt de hoogste stand, `null` blijft `null`.
  assert.equal(parseEntries(JSON.stringify([{ ...beurt(12), amps: 12.5 }]))[0]?.amps, RATED_CURRENT_A);
  assert.equal(parseEntries(JSON.stringify([{ ...beurt(12), amps: "10" }]))[0]?.amps, RATED_CURRENT_A);
  assert.equal(parseEntries(JSON.stringify([{ ...beurt(12), amps: null }]))[0]?.amps, null);
  // Aanvullen zonder stand (een oude versie van de app) wist de bewaarde stand niet.
  assert.equal(withEntry(op10, { ...beurt(12), km: 84300 })[0]?.amps, 10);
});

test("logbook: bewaren sorteert op tijd, verwijderen gaat op starttijd", () => {
  const lijst = withEntry(withEntry([], beurt(19)), beurt(12));
  assert.deepEqual(lijst.map((e) => e.km), [84222, 84229]);
  assert.deepEqual(withoutEntry(lijst, beurt(12).startMs).map((e) => e.km), [84229]);
  assert.equal(withoutEntry(lijst, 0).length, 2); // onbekende starttijd verwijdert niets
});

test("logbook: markdown is precies wat je onder de kop in log.md plakt", () => {
  assert.equal(
    toMarkdown(withEntry(withEntry([], beurt(19, 38)), beurt(12))),
    "| 2026-09-12 | 84222 | 43 | 90 | 22:10 | 05:05 |  |  |  |\n" +
      "| 2026-09-19 | 84229 | 38 | 90 | 22:10 | 05:05 |  |  |  |",
  );
  assert.equal(toMarkdown([]), "");
});

test("logbook: een vergeten beurt achteraf krijgt een eigen regel en overschrijft niets", () => {
  const vorige = beurt(12);
  const nieuw = manualEntry({ date: "2026-10-02", from: "11:00", to: "15:00", fromPercent: 60, toPercent: 100, km: 97280, amps: 16 });
  assert.ok(typeof nieuw !== "string");
  const samen = withEntry([vorige], nieuw);
  assert.equal(samen.length, 2);
  assert.deepEqual(samen.find((e) => e.startMs === vorige.startMs), vorige);
  assert.equal((nieuw.endMs - nieuw.startMs) / 3_600_000, 4);
  assert.equal(new Date(nieuw.startMs).getHours(), 11); // lokale tijd, geen UTC
});

test("logbook: achteraf invoeren over middernacht en met onzin", () => {
  const nacht = manualEntry({ date: "2026-10-02", from: "22:00", to: "02:00", fromPercent: 40, toPercent: 90, km: null, amps: 16 });
  assert.ok(typeof nacht !== "string");
  assert.equal((nacht.endMs - nacht.startMs) / 3_600_000, 4);
  assert.equal(typeof manualEntry({ date: "", from: "11:00", to: "15:00", fromPercent: 60, toPercent: 100, km: null, amps: 16 }), "string");
  assert.equal(typeof manualEntry({ date: "2026-10-02", from: "11:00", to: "15:00", fromPercent: 80, toPercent: 70, km: null, amps: 16 }), "string");
  assert.equal(typeof manualEntry({ date: "2026-10-02", from: "11:00", to: "15:00", fromPercent: NaN, toPercent: 70, km: null, amps: 16 }), "string");
});

test("logbook: achteraf invoeren weigert toekomst en meer dan 12 uur", () => {
  const basis = { fromPercent: 40, toPercent: 90, km: null, amps: 16 };
  assert.equal(typeof manualEntry({ ...basis, date: "2999-01-01", from: "11:00", to: "15:00" }), "string");
  assert.equal(typeof manualEntry({ ...basis, date: "2026-10-02", from: "11:00", to: "11:00" }), "string"); // 24 uur
  assert.equal(typeof manualEntry({ ...basis, date: "2026-10-02", from: "11:00", to: "15:00" }), "object");
  // De grens: precies 12 uur mag, 13 niet. En een datum die niet bestaat rolt niet stil door naar maart.
  assert.equal(typeof manualEntry({ ...basis, date: "2026-10-02", from: "08:00", to: "20:00" }), "object");
  assert.equal(typeof manualEntry({ ...basis, date: "2026-10-02", from: "08:00", to: "21:00" }), "string");
  assert.equal(typeof manualEntry({ ...basis, date: "2026-02-30", from: "08:00", to: "10:00" }), "string");
});

test("logbook: een geschatte beurt blijft staan maar telt niet, en een latere aflezing maakt hem gemeten", () => {
  const geschat = withEntry([], { ...beurt(12), amps: 16, estimated: true });
  assert.equal(geschat[0]?.estimated, true);
  // In log.md staat het als 'geschat' achter de stand, en het overleeft opslag.
  assert.ok(toMarkdown(geschat).endsWith("| 16 A; geschat |"), toMarkdown(geschat));
  assert.equal(parseEntries(JSON.stringify(geschat))[0]?.estimated, true);
  // Oudere opslag kent het veld niet: dan is de regel niet geschat.
  assert.equal(parseEntries(JSON.stringify([beurt(12)]))[0]?.estimated, false);
  // Dezelfde beurt opnieuw bewaren, nu met een echte aflezing: het nieuwste woord wint.
  const gemeten = withEntry(geschat, { ...beurt(12), amps: 16, estimated: false, toPercent: 88 });
  assert.equal(gemeten.length, 1);
  assert.equal(gemeten[0]?.estimated, false);
  assert.equal(gemeten[0]?.toPercent, 88);
  // En een regel van achteraf invoeren is altijd gemeten: eind% is daar verplicht.
  const achteraf = manualEntry({ date: "2026-09-01", from: "10:00", to: "14:00", fromPercent: 40, toPercent: 85, km: null, amps: 16 });
  assert.equal(typeof achteraf === "string" ? null : achteraf.estimated, false);
});

test("updatableFinished: alleen een nog geschatte, recent afgekoppelde beurt", () => {
  const nu = new Date(2026, 9, 10, 18, 0).getTime();
  const uur = 3_600_000;
  const klaar = (geleden: number) => ({ startMs: nu - geleden - 2 * uur, endMs: nu - geleden });
  const regel = (f: { startMs: number; endMs: number }, estimated: boolean): Entry => ({
    ...beurt(12), startMs: f.startMs, endMs: f.endMs, estimated,
  });
  assert.equal(updatableFinished(null, [], nu), null);
  const net = klaar(0.1 * uur);
  assert.equal(updatableFinished(net, [], nu), net);
  assert.equal(updatableFinished(net, [regel(net, true)], nu), net);
  assert.equal(updatableFinished(net, [regel(net, false)], nu), null);
  const vanochtend11 = { startMs: nu - 14 * uur, endMs: nu - 11 * uur };
  assert.equal(updatableFinished(vanochtend11, [], nu), vanochtend11);
  const gisteren13 = { startMs: nu - 22 * uur, endMs: nu - 19 * uur }; // gisteren 23:00, 19 u geleden
  assert.equal(updatableFinished(gisteren13, [], nu), null);
  const vanochtend = { startMs: nu - 15 * uur, endMs: nu - 13 * uur }; // 05:00 vandaag: >12 u geleden maar vandaag
  assert.equal(updatableFinished(vanochtend, [], nu), vanochtend);
  // De <12 u-tak apart: het is 06:00, de beurt eindigde gisteren 23:00 (7 u geleden) en niet "vandaag".
  const ochtend = new Date(2026, 9, 10, 6, 0).getTime();
  const laatAvond = { startMs: ochtend - 10 * uur, endMs: ochtend - 7 * uur };
  assert.equal(updatableFinished(laatAvond, [], ochtend), laatAvond);
  assert.equal(updatableFinished(laatAvond, [], ochtend + 6 * uur), null); // 13 u geleden, andere dag
  const drieDagen = klaar(72 * uur);
  assert.equal(updatableFinished(drieDagen, [], nu), null);
});

test("usageChart: elke geldige rit een staaf, een uitschieter gedempt, gemiddelde = bereik", () => {
  const lijst: Entry[] = [
    sessie(1, 50, 90, 4, { km: 1000 }),
    sessie(3, 50, 90, 4, { km: 1080 }),
    sessie(5, 50, 90, 4, { km: 1160 }),
    sessie(7, 50, 90, 4, { km: 1244 }),
    sessie(9, 60, 90, 4, { km: 1330 }), // laatste rit 2,87: geldig, telt niet mee
  ];
  const c = usageChart(lijst);
  assert.ok(c !== null);
  assert.equal(c.bars.length, 4);
  assert.deepEqual(c.bars.map((b) => b.counted), [true, true, true, false]);
  assert.equal(c.mean, kmPerPp(lijst).value);
  assert.match(c.svg, /<svg/);
  assert.equal(usageChart([sessie(1, 50, 90, 4, { km: 1000 })]), null);
  assert.equal(usageChart([]), null);
});
