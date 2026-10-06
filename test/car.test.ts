import assert from "node:assert/strict";
import { test } from "node:test";

import { lookupPlate, type FetchFn } from "../src/car.js";
import {
  LEAF_ID,
  activeCar,
  adoptLegacy,
  carFromPlate,
  carKey,
  carTitle,
  formatPlate,
  isPlate,
  normalizePlate,
  parseCars,
  parseRdw,
  withCar,
  withoutCar,
} from "../src/core/car.js";
import { percentAfter, estimate } from "../src/core/charge.js";
import { LEAF_START, START_KM_PER_PP, START_RATE_PP_PER_H, kmPerPp, ratePerHour, setupAt } from "../src/core/derive.js";

const RDW_ANTWOORD = [
  { kenteken: "GZ123B", voertuigsoort: "Personenauto", merk: "NISSAN", handelsbenaming: "LEAF", uitvoering: "ZE1", datum_eerste_toelating: "20190412" },
];

test("normalizePlate: streepjes, spaties en kleine letters weg", () => {
  assert.equal(normalizePlate("gz-123-b"), "GZ123B");
  assert.equal(normalizePlate(" 12 abc 3 "), "12ABC3");
  assert.equal(isPlate("GZ123B"), true);
  assert.equal(isPlate("GZ12B"), false);
  assert.equal(isPlate("GZ123B1"), false);
});

test("formatPlate: streepjes volgens de klasse, kaal bij iets onbekends", () => {
  assert.equal(formatPlate("GZ123B"), "GZ-123-B");
  assert.equal(formatPlate("12ABC3"), "12-ABC-3");
  assert.equal(formatPlate("1ABC23"), "1-ABC-23");
  assert.equal(formatPlate("AB1234"), "AB-12-34");
  assert.equal(formatPlate("AB12"), "AB12");
});

test("parseRdw: merk, model, bouwjaar; hoofdletters worden netjes", () => {
  const r = parseRdw(RDW_ANTWOORD);
  assert.deepEqual(r, { merk: "Nissan", model: "Leaf", uitvoering: "ZE1", jaar: 2019, voertuigsoort: "Personenauto" });
});

test("parseRdw: lege lijst, rommel en ontbrekende velden", () => {
  assert.equal(parseRdw([]), null);
  assert.equal(parseRdw(null), null);
  assert.equal(parseRdw({}), null);
  assert.equal(parseRdw([{ merk: "" }]), null);
  const kaal = parseRdw([{ merk: "TESLA" }]);
  assert.deepEqual(kaal, { merk: "Tesla", model: "", uitvoering: "", jaar: null, voertuigsoort: "" });
  assert.equal(parseRdw([{ merk: "X", datum_eerste_toelating: "2019" }])?.jaar, null);
});

test("carTitle: RDW-naam met kenteken, of het eigen label", () => {
  const met = carFromPlate("GZ123B", parseRdw(RDW_ANTWOORD), "");
  assert.equal(carTitle(met), "Nissan Leaf · GZ-123-B");
  assert.equal(carTitle({ ...met, rdw: null, label: "Oma's auto" }), "Oma's auto · GZ-123-B");
  assert.equal(carTitle({ id: "x", label: "", plate: null, rdw: null, start: null }), "Auto");
});

test("carKey: de Leaf houdt de oude sleutels, de rest krijgt een achtervoegsel", () => {
  assert.equal(carKey("logbook", LEAF_ID), "e-charge.logbook");
  assert.equal(carKey("session", LEAF_ID), "e-charge.session");
  assert.equal(carKey("finished", "GZ123B"), "e-charge.finished.GZ123B");
});

test("parseCars: kapotte regels en dubbele id's vallen weg", () => {
  assert.deepEqual(parseCars(null), []);
  assert.deepEqual(parseCars("geen json"), []);
  assert.deepEqual(parseCars('{"a":1}'), []);
  const lijst = parseCars(
    JSON.stringify([
      { id: "leaf", label: "Leaf", plate: null, start: { ratePpPerHour: 10, kmPerPp: 2 } },
      { id: "leaf", label: "dubbel" },
      { id: "", label: "leeg" },
      42,
      { id: "AB1234", label: "", plate: "ab1234", start: { ratePpPerHour: -1, kmPerPp: 2 } },
    ]),
  );
  assert.equal(lijst.length, 2);
  assert.deepEqual(lijst[0]!.start, { ratePpPerHour: 10, kmPerPp: 2 });
  assert.equal(lijst[1]!.plate, null); // niet genormaliseerd in opslag: onbruikbaar, niet stil gerepareerd
  assert.equal(lijst[1]!.start, null); // een negatieve snelheid is geen startwaarde
});

test("activeCar: de bewaarde, anders de eerste, anders niets", () => {
  const a = carFromPlate("AA1111", null, "a");
  const b = carFromPlate("BB2222", null, "b");
  assert.equal(activeCar([a, b], "BB2222"), b);
  assert.equal(activeCar([a, b], "weg"), a);
  assert.equal(activeCar([a, b], null), a);
  assert.equal(activeCar([], "x"), null);
});

test("withCar / withoutCar: vervangen op id, volgorde blijft", () => {
  const a = carFromPlate("AA1111", null, "a");
  const b = carFromPlate("BB2222", null, "b");
  const lijst = withCar([a, b], { ...a, label: "nieuw" });
  assert.deepEqual(lijst.map((c) => c.label), ["nieuw", "b"]);
  assert.deepEqual(withoutCar(lijst, "AA1111").map((c) => c.id), ["BB2222"]);
});

test("adoptLegacy: eerste start maakt de Leaf, daarna nooit meer", () => {
  const eerste = adoptLegacy([], false);
  assert.equal(eerste.changed, true);
  assert.equal(eerste.cars.length, 1);
  assert.equal(eerste.cars[0]!.id, LEAF_ID);
  assert.deepEqual(eerste.cars[0]!.start, LEAF_START);
  // al gemigreerd: een bewust verwijderde Leaf komt niet terug
  assert.deepEqual(adoptLegacy([], true), { cars: [], changed: false });
  // een bestaande lijst blijft zoals ze is
  const lijst = [carFromPlate("AA1111", null, "a")];
  assert.deepEqual(adoptLegacy(lijst, false), { cars: lijst, changed: false });
});

test("zonder startwaarden is de snelheid onbekend en rekent niets door", () => {
  assert.deepEqual(ratePerHour([], 16, null), { value: NaN, n: 0, source: "onbekend" });
  assert.equal(ratePerHour([], 8, null).source, "onbekend");
  assert.equal(kmPerPp([], null).source, "onbekend");
  const opzet = setupAt(16, [], null);
  assert.equal(estimate(40, 80, opzet).needed, false);
  assert.equal(percentAfter(40, 80, 3_600_000, opzet), 40); // geen NaN
  // en met de Leaf-startwaarden blijft alles zoals het was
  assert.equal(ratePerHour([], 16).value, START_RATE_PP_PER_H);
  assert.equal(kmPerPp([]).value, START_KM_PER_PP);
});

const antwoord = (body: unknown, ok = true): FetchFn => async () => ({ ok, json: async () => body });

test("lookupPlate: gevonden, niet gevonden, mislukt en een ongeldig kenteken zonder netwerk", async () => {
  const g = await lookupPlate("GZ123B", antwoord(RDW_ANTWOORD));
  assert.equal(g.kind, "gevonden");
  assert.deepEqual(await lookupPlate("GZ123B", antwoord([])), { kind: "niet gevonden" });
  assert.deepEqual(await lookupPlate("GZ123B", antwoord([], false)), { kind: "mislukt" });
  assert.deepEqual(await lookupPlate("GZ123B", async () => { throw new Error("offline"); }), { kind: "mislukt" });
  let aangeroepen = false;
  const spion: FetchFn = async () => { aangeroepen = true; return { ok: true, json: async () => [] }; };
  assert.deepEqual(await lookupPlate("kort", spion), { kind: "niet gevonden" });
  assert.equal(aangeroepen, false);
});

test("lookupPlate: de URL bevat alleen het genormaliseerde kenteken", async () => {
  let url = "";
  await lookupPlate("GZ123B", async (u) => { url = u; return { ok: true, json: async () => [] }; });
  assert.equal(url, "https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=GZ123B");
});
