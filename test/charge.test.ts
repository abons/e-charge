import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETUP, clampPercent, estimate, percentAfter, rangeKm } from "../src/core/charge.js";
import { calendar } from "../src/core/ics.js";
import { logRow } from "../src/core/logline.js";
import { clock, dayLabel, dayOffset, duration, number as nl } from "../src/core/time.js";

/** De rekenkern en de weergave. Eén laadsessie is niet te controleren met een debugger, dus hier. */

test("estimate: 43% → 90% aan een stopcontact", () => {
  const result = estimate(43, 90);
  assert.equal(result.needed, true);
  // 47% van 39 kWh = 18,33 kWh netto de batterij in.
  assert.equal(result.energyKwh.toFixed(2), "18.33");
  // Daarvoor moet er 18,33 / 0,88 = 20,83 kWh uit de muur komen.
  assert.equal(result.wallEnergyKwh.toFixed(2), "20.83");
  // 3,0 kW × 88% = 2,64 kW effectief; 18,33 / 2,64 = 6,94 uur.
  assert.equal(result.effectivePowerKw.toFixed(3), "2.640");
  assert.equal(duration(result.minutes), "6u 57m");
});

test("estimate: rendement maakt het langer, nooit korter", () => {
  const lossless = estimate(43, 90, { ...DEFAULT_SETUP, efficiency: 1 });
  const real = estimate(43, 90);
  assert.ok(real.minutes > lossless.minutes);
  assert.equal(lossless.energyKwh, real.energyKwh); // in de batterij moet hetzelfde
  assert.equal(lossless.wallEnergyKwh.toFixed(2), lossless.energyKwh.toFixed(2));
});

test("estimate: alles wat aan de auto hangt is te verzetten", () => {
  const other = estimate(0, 100, { ...DEFAULT_SETUP, capacityKwh: 62, powerKw: 11, efficiency: 0.92 });
  assert.equal(other.energyKwh, 62);
  assert.equal(other.effectivePowerKw.toFixed(2), "10.12");
  assert.equal(duration(other.minutes), "6u 08m");
});

test("estimate: doel al gehaald betekent niet laden", () => {
  for (const [from, to] of [[90, 90], [95, 90], [100, 0]] as const) {
    const result = estimate(from, to);
    assert.equal(result.needed, false, `${from} → ${to}`);
    assert.equal(result.minutes, 0);
  }
  // Het vermogen blijft ook dan gewoon bekend — het is een eigenschap van de lader, niet van de rit.
  assert.equal(estimate(90, 90).effectivePowerKw.toFixed(3), "2.640");
});

test("estimate: rondt minuten naar boven en klemt percentages", () => {
  assert.equal(estimate(-10, 200).energyKwh, 39); // 0 → 100
  assert.equal(estimate(89.6, 90).minutes, Math.ceil(estimate(90, 90).minutes)); // 89,6 rondt naar 90
  assert.ok(Number.isInteger(estimate(43, 90).minutes));
});

test("rangeKm: procenten naar kilometers, naar beneden afgerond", () => {
  // 39 kWh bij 17 kWh/100 km = 229 km vol; 90% daarvan is 206.
  assert.equal(rangeKm(100), 229);
  assert.equal(rangeKm(90), 206);
  assert.equal(rangeKm(43), 98);
  assert.equal(rangeKm(0), 0);
  // Een zuiniger of dorstiger auto verzet het bereik, net als bij estimate().
  assert.equal(rangeKm(100, { ...DEFAULT_SETUP, consumptionKwhPer100Km: 13 }), 300);
  // Een versleten pakket levert minder km bij hetzelfde percentage.
  assert.equal(rangeKm(100, { ...DEFAULT_SETUP, capacityKwh: 35.1 }), 206);
});

test("percentAfter: loopt op met het laadvermogen en stopt op het doel", () => {
  // 2,64 kW effectief in 39 kWh: 6,77 procentpunt per uur.
  assert.equal(percentAfter(43, 90, 0).toFixed(1), "43.0");
  assert.equal(percentAfter(43, 90, 3_600_000).toFixed(1), "49.8");
  assert.equal(percentAfter(43, 90, 3 * 3_600_000).toFixed(1), "63.3");
  // Na de geschatte laadtijd staat hij precies op het doel, en gaat er niet overheen.
  const minutes = estimate(43, 90).minutes;
  assert.equal(percentAfter(43, 90, minutes * 60_000), 90);
  assert.equal(percentAfter(43, 90, 99 * 3_600_000), 90);
});

test("percentAfter: onzinnige invoer levert gewoon het startpunt op", () => {
  assert.equal(percentAfter(43, 90, -1), 43);
  assert.equal(percentAfter(90, 90, 3_600_000), 90); // niets te laden
  assert.equal(percentAfter(95, 90, 3_600_000), 95); // al voorbij het doel
});

test("percentAfter en estimate zijn elkaars omgekeerde", () => {
  // Wat estimate() als laadtijd geeft, moet percentAfter() precies op het doel uitbrengen — anders
  // zou de aftelling op het scherm iets anders zeggen dan de eindtijd erboven.
  for (const [from, to] of [[10, 80], [43, 90], [0, 100], [65, 66]] as const) {
    const ms = estimate(from, to).minutes * 60_000;
    assert.equal(percentAfter(from, to, ms), to, `${from} → ${to}`);
    // Eén minuut eerder is hij er nog net niet (afronden naar boven zit in estimate).
    assert.ok(percentAfter(from, to, ms - 60_000) < to, `${from} → ${to}`);
  }
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
    logRow({ startMs: start, endMs: eind, fromPercent: 43, toPercent: 90, km: 84210, kwh: 20.4 }),
    "| 2026-09-12 | 84210 | 43 | 90 | 22:10 | 05:05 | 20.4 |  |",
  );
  // De datum is die van het insteken, ook als het afkoppelen de volgende dag is.
  assert.ok(logRow({ startMs: start, endMs: eind, fromPercent: 43, toPercent: 90 }).startsWith("| 2026-09-12 |"));
});

test("logRow: lege kolommen blijven leeg, percentages worden heel", () => {
  const start = new Date(2026, 8, 12, 9, 0).getTime();
  assert.equal(
    logRow({ startMs: start, endMs: start + 3_600_000, fromPercent: 43.4, toPercent: 89.6 }),
    "| 2026-09-12 |  | 43 | 90 | 09:00 | 10:00 |  |  |",
  );
});
