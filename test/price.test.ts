import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ENERGY_TAX_EUR_PER_KWH,
  SUPPLIER_MARKUP_EUR_PER_KWH,
  VAT,
  allInEurPerKwh,
  chargingCost,
  covered,
  mergeQuarters,
  parseEnergyCharts,
  parseEnergyZero,
  parseQuarters,
  type Quarter,
} from "../src/core/price.js";

/** De kwartierprijzen en de kostensom. Het net is niet te testen; wat ervan gemaakt wordt wel. */

const T0 = Date.parse("2026-09-25T20:00:00Z"); // 22:00 lokale zomertijd
const Q = 15 * 60_000;

test("allInEurPerKwh: marktprijs + opslag + belasting, en daar btw over", () => {
  // 8 ct op de markt is bij Zonneplan (0,08 + 0,01652 + 0,09161) × 1,21 = 22,76 ct.
  assert.equal(allInEurPerKwh(0.08).toFixed(4), "0.2276");
  assert.equal(allInEurPerKwh(0).toFixed(4), ((SUPPLIER_MARKUP_EUR_PER_KWH + ENERGY_TAX_EUR_PER_KWH) * VAT).toFixed(4));
  // Een negatieve marktprijs trekt de belasting niet weg; de rekening blijft positief.
  assert.ok(allInEurPerKwh(-0.05) > 0);
});

test("parseEnergyZero: kwartieren uit Prices[], marktprijs naar all-in", () => {
  const json = {
    Prices: [
      { price: 0.1, readingDate: "2026-09-25T20:00:00Z" },
      { price: 0.08, readingDate: "2026-09-25T20:15:00Z" },
      { price: "kapot", readingDate: "2026-09-25T20:30:00Z" },
      { price: 0.12, readingDate: "2026-09-25T20:45:00Z" },
    ],
    intervalType: 3,
  };
  const q = parseEnergyZero(json);
  assert.equal(q.length, 3);
  assert.deepEqual(q.map((x) => x.startMs), [T0, T0 + Q, T0 + 3 * Q]);
  assert.equal(q[0]?.endMs, T0 + Q);
  assert.equal(q[0]?.eurPerKwh.toFixed(4), allInEurPerKwh(0.1).toFixed(4));
  // Onzin levert een lege lijst, geen uitzondering.
  assert.deepEqual(parseEnergyZero(null), []);
  assert.deepEqual(parseEnergyZero({ Prices: "nee" }), []);
  assert.deepEqual(parseEnergyZero({ Prices: [{ price: 1 }] }), []);
});

test("parseEnergyZero: een bron die per uur levert, dekt het hele uur", () => {
  const q = parseEnergyZero({
    Prices: [
      { price: 0.1, readingDate: "2026-09-25T20:00:00Z" },
      { price: 0.1, readingDate: "2026-09-25T21:00:00Z" },
    ],
  });
  assert.equal(q[0]?.endMs, T0 + 4 * Q);
  assert.equal(q[1]?.endMs, T0 + 8 * Q);
});

test("parseEnergyCharts: twee rijen, €/MWh naar €/kWh", () => {
  const q = parseEnergyCharts({ unix_seconds: [T0 / 1000, T0 / 1000 + 900], price: [80, 120], unit: "EUR / MWh" });
  assert.equal(q.length, 2);
  assert.equal(q[0]?.eurPerKwh.toFixed(4), allInEurPerKwh(0.08).toFixed(4));
  assert.equal(q[1]?.startMs, T0 + Q);
  assert.deepEqual(parseEnergyCharts({ unix_seconds: [1], price: "x" }), []);
  assert.deepEqual(parseEnergyCharts(undefined), []);
});

test("parseQuarters: wat uit opslag komt wordt niet vertrouwd", () => {
  const goed: Quarter = { startMs: T0, endMs: T0 + Q, eurPerKwh: 0.25 };
  const q = parseQuarters([goed, { startMs: T0 + Q, endMs: T0, eurPerKwh: 1 }, "x", { startMs: 1, endMs: 2, eurPerKwh: NaN }]);
  assert.deepEqual(q, [goed]);
  assert.deepEqual(parseQuarters("nee"), []);
});

test("mergeQuarters: nieuw wint op gelijke start, oud verdwijnt", () => {
  const oud: Quarter[] = [
    { startMs: T0 - 5 * Q, endMs: T0 - 4 * Q, eurPerKwh: 0.1 },
    { startMs: T0, endMs: T0 + Q, eurPerKwh: 0.2 },
  ];
  const nieuw: Quarter[] = [{ startMs: T0, endMs: T0 + Q, eurPerKwh: 0.3 }];
  const samen = mergeQuarters(oud, nieuw, T0 - Q);
  assert.deepEqual(samen, nieuw);
});

const prijzen: Quarter[] = [0.2, 0.3, 0.4, 0.5].map((eurPerKwh, i) => ({ startMs: T0 + i * Q, endMs: T0 + (i + 1) * Q, eurPerKwh }));

test("chargingCost: elk kwartier tegen zijn eigen prijs, naar rato aan de randen", () => {
  // Eén vol kwartier aan 3,5 kW is 0,875 kWh; à 20 ct is dat 17,5 ct.
  const een = chargingCost(T0, T0 + Q, 3.5, prijzen);
  assert.ok(een !== null && een.complete);
  assert.equal(een.eur.toFixed(4), "0.1750");
  assert.equal(een.avgEurPerKwh.toFixed(2), "0.20");
  // Van halverwege het eerste tot halverwege het derde kwartier: ½×0,2 + 1×0,3 + ½×0,4 = 0,65 kWh-gewogen.
  const twee = chargingCost(T0 + Q / 2, T0 + 2.5 * Q, 3.5, prijzen);
  assert.ok(twee !== null && twee.complete);
  assert.equal(twee.eur.toFixed(4), (0.875 * (0.5 * 0.2 + 0.3 + 0.5 * 0.4)).toFixed(4));
  assert.equal(twee.avgEurPerKwh.toFixed(2), "0.30");
});

test("chargingCost: buiten de bekende prijzen wordt geschat, en dat staat erbij", () => {
  // Zes kwartieren laden, vier bekend (gemiddeld 35 ct): de laatste twee tellen tegen dat gemiddelde.
  const kost = chargingCost(T0, T0 + 6 * Q, 3.5, prijzen);
  assert.ok(kost !== null);
  assert.equal(kost.complete, false);
  assert.equal(kost.coveredMs, 4 * Q);
  assert.equal(kost.totalMs, 6 * Q);
  assert.equal(kost.avgEurPerKwh.toFixed(2), "0.35");
  assert.equal(kost.eur.toFixed(4), (0.875 * 6 * 0.35).toFixed(4));
  // Geen enkel bekend kwartier: niets te zeggen.
  assert.equal(chargingCost(T0 + 10 * Q, T0 + 12 * Q, 3.5, prijzen), null);
  assert.equal(chargingCost(T0, T0 + Q, 0, prijzen), null);
});

test("covered: alleen waar als elk moment een prijs heeft", () => {
  assert.equal(covered(T0, T0 + 4 * Q, prijzen), true);
  assert.equal(covered(T0, T0 + 4 * Q + 1, prijzen), false);
  assert.equal(covered(T0 - 1, T0 + Q, prijzen), false);
  assert.equal(covered(T0, T0, []), true); // niets te laden, niets te weten
});
