import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_HORIZON_MS, MIN_SAVING_EUR, cheapestStart, readyBy } from "../src/core/advice.js";
import { priceChart } from "../src/core/chart.js";
import type { Quarter } from "../src/core/price.js";

/** Het startadvies en de grafiek erachter: alleen getallen, dus helemaal te testen. */

const T0 = Date.parse("2026-10-08T07:00:00Z"); // 09:00 lokale zomertijd, op een kwartiergrens
const Q = 15 * 60_000;
const H = 4 * Q;

/** Kwartieren vanaf T0 met deze prijzen in cent per kWh. */
const dag = (cts: number[]): Quarter[] =>
  cts.map((c, i) => ({ startMs: T0 + i * Q, endMs: T0 + (i + 1) * Q, eurPerKwh: c / 100 }));

test("cheapestStart: het goedkoopste venster, met wat het scheelt met nu", () => {
  // Twee uur duur (40 ct), dan twee uur goedkoop (20 ct), dan weer duur.
  const qs = dag([...Array(8).fill(40), ...Array(8).fill(20), ...Array(8).fill(40)]);
  const a = cheapestStart(T0, 2 * H, 3.5, qs);
  assert.ok(a !== null);
  assert.equal(a.startMs, T0 + 2 * H);
  assert.equal(a.endMs, T0 + 4 * H);
  // 7 kWh × 20 ct tegen 7 kWh × 40 ct.
  assert.equal(a.eur.toFixed(2), "1.40");
  assert.equal(a.nowEur.toFixed(2), "2.80");
  assert.equal(a.savingEur.toFixed(2), "1.40");
});

test("cheapestStart: nu starten midden in een kwartier, daarna op de kwartiergrenzen", () => {
  const qs = dag([...Array(4).fill(40), ...Array(8).fill(10)]);
  const nu = T0 + 7 * 60_000;
  const a = cheapestStart(nu, H, 2, qs);
  assert.ok(a !== null);
  assert.equal(a.startMs, T0 + H);
  assert.equal((a.startMs - T0) % Q, 0);
});

test("cheapestStart: bij gelijke prijs, of een verschil onder de drempel, is het advies nu", () => {
  const vlak = cheapestStart(T0, H, 3.5, dag(Array(16).fill(25)));
  assert.ok(vlak !== null);
  assert.equal(vlak.startMs, T0);
  assert.equal(vlak.savingEur, 0);
  // Eén cent per kWh goedkoper over 1 kWh scheelt 1 cent: niet de moeite.
  const bijna = cheapestStart(T0, H, 1, dag([...Array(4).fill(25), ...Array(4).fill(24)]));
  assert.ok(bijna !== null && MIN_SAVING_EUR > 0.01);
  assert.equal(bijna.startMs, T0);
});

test("cheapestStart: alleen vensters die helemaal geprijsd zijn", () => {
  // Het goedkope stuk loopt tot het eind van de bekende prijzen: een venster dat erover zou lopen telt niet.
  const qs = dag([...Array(8).fill(40), ...Array(4).fill(5)]);
  const a = cheapestStart(T0, 2 * H, 3.5, qs);
  assert.ok(a !== null);
  assert.equal(a.endMs, T0 + 3 * H);
  // Een gat midden in het goedkope stuk: elk venster van een uur dat helemaal in de 5 ct valt, raakt
  // kwartier 8. Telde een geschat venster mee, dan won start 6 of 7 (gemiddelde 5 ct over het bekende
  // deel); goed is start 9 (5, 5, 30, 30), het goedkoopste venster zonder gat.
  const gat = dag([40, 40, 40, 40, 40, 40, 5, 5, 5, 5, 5, 30, 30, 30, 30, 30]).filter((_, i) => i !== 8);
  const b = cheapestStart(T0, H, 3.5, gat);
  assert.ok(b !== null);
  assert.equal(b.startMs, T0 + 9 * Q);
});

test("cheapestStart: zonder volledige prijs voor nu, of zonder duur, geen advies", () => {
  assert.equal(cheapestStart(T0, 5 * H, 3.5, dag(Array(8).fill(30))), null);
  assert.equal(cheapestStart(T0, 0, 3.5, dag(Array(8).fill(30))), null);
  assert.equal(cheapestStart(T0, H, 3.5, []), null);
});

test("cheapestStart: klaar vóór een deadline, en tooLate als zelfs nu dat niet haalt", () => {
  // Goedkoop pas na vier uur: met een deadline op drie uur blijft alleen het duurdere begin over.
  const qs = dag([...Array(8).fill(40), ...Array(4).fill(30), ...Array(12).fill(10)]);
  const vrij = cheapestStart(T0, H, 3.5, qs);
  assert.equal(vrij?.startMs, T0 + 3 * H);
  const krap = cheapestStart(T0, H, 3.5, qs, T0 + 3 * H);
  assert.equal(krap?.startMs, T0 + 2 * H);
  assert.equal(krap?.endMs, T0 + 3 * H);
  assert.equal(krap?.tooLate, false);
  const teLaat = cheapestStart(T0, 4 * H, 3.5, qs, T0 + 3 * H);
  assert.equal(teLaat?.startMs, T0);
  assert.equal(teLaat?.tooLate, true);
  assert.equal(teLaat?.savingEur, 0);
});

test("cheapestStart: de besparing is het verschil van de twee bedragen in hele centen", () => {
  // 3,1551 en 2,6649 euro: op het scherm € 3,16 en € 2,66, dus € 0,50 — niet afgerond 0,49.
  const qs = dag([...Array(4).fill(315.51), ...Array(4).fill(266.49)]);
  const a = cheapestStart(T0, H, 1, qs);
  assert.equal(a?.savingEur, 0.5);
});

test("readyBy: het eerstvolgende hele uur, of een etmaal zonder voorkeur", () => {
  const d = new Date(2026, 9, 8, 21, 30).getTime();
  assert.equal(readyBy(d, 7), new Date(2026, 9, 9, 7).getTime());
  assert.equal(readyBy(d, 23), new Date(2026, 9, 8, 23).getTime());
  // Precies op het uur telt als voorbij: dan is het morgen.
  assert.equal(readyBy(new Date(2026, 9, 8, 7).getTime(), 7), new Date(2026, 9, 9, 7).getTime());
  assert.equal(readyBy(d, null), d + DEFAULT_HORIZON_MS);
});

test("priceChart: de schaal klopt met de kwartieren en de vinger vindt het goede kwartier", () => {
  const qs = dag([...Array(8).fill(40), ...Array(8).fill(20)]);
  const c = priceChart(qs, T0 + 10 * 60_000, [{ startMs: T0 + 2 * H, endMs: T0 + 4 * H, kind: "advies" }], T0 + 4 * H);
  assert.ok(c !== null);
  assert.match(c.svg, /^<svg /);
  // Laagste en hoogste prijs als label.
  assert.match(c.svg, />20 ct</);
  assert.match(c.svg, />40 ct</);
  // Een band voor het advies.
  assert.match(c.svg, /fill="#7fd4a0" fill-opacity="0.22"/);
  // De duurdere prijs staat hoger (kleinere y).
  assert.ok(c.y(0.4) < c.y(0.2));
  const midden = T0 + 3 * H + 7 * 60_000;
  assert.equal(c.quarterAt(c.msAt(c.x(midden)))?.eurPerKwh, 0.2);
  // Buiten het bereik klemt de vinger op de rand.
  assert.equal(c.msAt(-100), T0);
  assert.equal(c.msAt(10_000), T0 + 4 * H - 1);
});

test("priceChart: houdt een uur na de grens op, en noemt alleen een laagste prijs die je kunt halen", () => {
  // Tot twee uur 30 ct, dan 5 ct: met een grens op twee uur is 5 ct niet te halen.
  const qs = dag([...Array(8).fill(30), ...Array(4).fill(40), ...Array(12).fill(5)]);
  const c = priceChart(qs, T0, [], T0 + 2 * H, T0 + 2 * H);
  assert.ok(c !== null);
  assert.equal(c.msAt(10_000), T0 + 3 * H - 1);
  assert.doesNotMatch(c.svg, />5 ct</);
  assert.match(c.svg, />30 ct</);
  assert.match(c.svg, /vóór /);
});

test("priceChart: een gat tussen nu en de grens geeft geen labels, en geen fout", () => {
  // Alleen prijzen ná de grens (binnen het extra uur dat de grafiek toont): niets om een min/max van te nemen.
  const qs = dag(Array(12).fill(30)).slice(8);
  const c = priceChart(qs, T0, [], T0 + 2 * H);
  assert.ok(c !== null);
  assert.doesNotMatch(c.svg, / ct</);
});

test("priceChart: de nacht van de wintertijd loopt door het dubbele uur (geen lus die blijft hangen)", () => {
  // 25 oktober 2026: in Amsterdam komt 02:00–03:00 twee keer. Alleen zinvol in die tijdzone; Node
  // leest `TZ` opnieuw zodra hij verandert, en de tijdzone gaat na afloop terug.
  const oud = process.env.TZ;
  process.env.TZ = "Europe/Amsterdam";
  try {
    const nu = Date.parse("2026-10-24T22:00:00Z"); // 00:00 lokaal, nog zomertijd
    if (new Date(nu).getTimezoneOffset() !== -120) return; // geen tijdzonedata: niets te bewijzen
    const qs = Array.from({ length: 4 * 26 }, (_, i) => ({ startMs: nu + i * Q, endMs: nu + (i + 1) * Q, eurPerKwh: 0.3 }));
    const c = priceChart(qs, nu, [], nu + 24 * H);
    assert.ok(c !== null);
    // Twee keer "02" op de as zou een tick om de drie uur niet tonen, maar "03" wel precies één keer.
    assert.equal(c.svg.match(/>03</g)?.length, 1);
  } finally {
    if (oud === undefined) delete process.env.TZ;
    else process.env.TZ = oud;
  }
});

test("priceChart: niets te tekenen zonder prijzen na nu", () => {
  assert.equal(priceChart([], T0, [], T0 + H), null);
  assert.equal(priceChart(dag([30, 30]), T0 + 3 * H, [], T0 + 4 * H), null);
});
