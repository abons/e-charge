import assert from "node:assert/strict";
import { test } from "node:test";

import { lookupPlate, type FetchFn } from "../src/car.js";
import {
  FIRST_CAR_ID,
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
import { brands, estimateFromKwh, estimateStart, evById, matchEv, modelsOf, variantsOf } from "../src/core/evest.js";
import { LEAF_START, START_KM_PER_PP, START_RATE_PP_PER_H, kmPerPp, measureRate, ratePerHour, setupAt } from "../src/core/derive.js";

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

test("parseRdw: een merk dat ook in de handelsbenaming staat komt er maar één keer in", () => {
  const r = parseRdw([{ merk: "NISSAN", handelsbenaming: "NISSAN LEAF 40KWH" }]);
  assert.equal(r?.model, "Leaf 40KWH");
  assert.equal(carTitle(carFromPlate("XL312T", r, "")), "Nissan Leaf 40KWH · XL-312-T");
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
  assert.equal(carTitle({ id: "x", label: "", plate: null, rdw: null, start: null, ev: null }), "Auto");
});

test("carKey: de Leaf houdt de oude sleutels, de rest krijgt een achtervoegsel", () => {
  assert.equal(carKey("logbook", FIRST_CAR_ID), "e-charge.logbook");
  assert.equal(carKey("session", FIRST_CAR_ID), "e-charge.session");
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

test("parseCars: de eerste versie noemde de eerste auto 'leaf'; dat wordt de neutrale id, met dezelfde sleutels", () => {
  const [eerste] = parseCars(JSON.stringify([{ id: "leaf", label: "Nissan Leaf" }]));
  assert.equal(eerste!.id, FIRST_CAR_ID);
  assert.equal(carKey("logbook", eerste!.id), "e-charge.logbook");
});

test("activeCar: de bewaarde, anders de eerste, anders niets", () => {
  const a = carFromPlate("AA1111", null, "a");
  const b = carFromPlate("BB2222", null, "b");
  assert.equal(activeCar([a, b], "BB2222"), b);
  assert.equal(activeCar([a, b], "weg"), a);
  assert.equal(activeCar([a, b], null), a);
  assert.equal(activeCar([], "x"), null);
  // de oude naam van de eerste auto in de opgeslagen keuze, terwijl de eerste auto niet vooraan staat
  const eerste = { ...a, id: FIRST_CAR_ID };
  assert.equal(activeCar([a, eerste], "leaf"), eerste);
});

test("withCar / withoutCar: vervangen op id, volgorde blijft", () => {
  const a = carFromPlate("AA1111", null, "a");
  const b = carFromPlate("BB2222", null, "b");
  const lijst = withCar([a, b], { ...a, label: "nieuw" });
  assert.deepEqual(lijst.map((c) => c.label), ["nieuw", "b"]);
  assert.deepEqual(withoutCar(lijst, "AA1111").map((c) => c.id), ["BB2222"]);
});

test("adoptLegacy: eerste start maakt de Leaf, daarna nooit meer", () => {
  const eerste = adoptLegacy([], false, true);
  assert.equal(eerste.changed, true);
  assert.equal(eerste.cars.length, 1);
  assert.equal(eerste.cars[0]!.id, FIRST_CAR_ID);
  assert.deepEqual(eerste.cars[0]!.start, LEAF_START);
  // al gemigreerd: een bewust verwijderde Leaf komt niet terug
  assert.deepEqual(adoptLegacy([], true, true), { cars: [], changed: false });
  // een bestaande lijst blijft zoals ze is
  const lijst = [carFromPlate("AA1111", null, "a")];
  assert.deepEqual(adoptLegacy(lijst, false, true), { cars: lijst, changed: false });
});

test("adoptLegacy: een verse browser krijgt geen Leaf met de startwaarden van de eigenaar", () => {
  assert.deepEqual(adoptLegacy([], false, false), { cars: [], changed: false });
});

const LEAF_RDW = { merk: "Nissan", model: "Leaf 40KWH", uitvoering: "", jaar: 2019, voertuigsoort: "Personenauto" };

test("matchEv: een RDW-antwoord vindt de uitvoering met de juiste accu eerst", () => {
  const lijst = matchEv(LEAF_RDW);
  assert.ok(lijst.length >= 2); // meerdere Leafs in de tabel
  assert.equal(lijst[0]!.kwh, 38);
  assert.equal(lijst[0]!.model, "Leaf");
  assert.deepEqual(matchEv({ ...LEAF_RDW, merk: "Onbekendmerk" }), []);
  assert.deepEqual(matchEv(null), []);
  assert.deepEqual(matchEv({ ...LEAF_RDW, model: "Onbekendmodel" }), []);
});

test("estimateStart: Leaf 40 komt in de buurt van het logboek, aan de veilige kant, en is gemarkeerd", () => {
  const start = estimateStart(matchEv(LEAF_RDW)[0]!);
  assert.equal(start.estimated, true);
  assert.equal(start.ratePpPerHour, 7.8); // 3,5 kW x 85% / 38 kWh; gemeten 10,2 -> te langzaam, dus ruim gepland
  assert.equal(start.kmPerPp, 2.3); // 38 kWh / 16,4 kWh per 100 km; gemeten 2,0
});

test("Dacia en Toyota staan er ook in, en een RDW-antwoord vindt ze", () => {
  assert.ok(brands().includes("Dacia"));
  assert.ok(brands().includes("Toyota"));
  const spring = matchEv({ merk: "Dacia", model: "Spring", uitvoering: "", jaar: 2023, voertuigsoort: "Personenauto" });
  assert.equal(spring.length, 3);
  assert.ok(spring.every((e) => e.brand === "Dacia"));
  const bz4x = matchEv({ merk: "Toyota", model: "BZ4X", uitvoering: "", jaar: 2023, voertuigsoort: "Personenauto" });
  assert.equal(bz4x[0]!.kwh, 64);
  const chr = matchEv({ merk: "Toyota", model: "C-HR+", uitvoering: "", jaar: 2025, voertuigsoort: "Personenauto" });
  assert.deepEqual(chr.map((e) => e.kwh).sort(), [54, 72]);
  // Spring 45: 3,5 kW x 85% / 25 kWh
  assert.equal(estimateStart(spring[0]!).ratePpPerHour, 11.9);
});

test("estimateStart: een boordlader onder het stopcontactvermogen is de beperking", () => {
  const ev = { id: "x", brand: "A", model: "B", variant: "", year: null, kwh: 30, consumption: 15, acKw: 2 };
  assert.equal(estimateStart(ev).ratePpPerHour, round1((2 * 0.85 * 100) / 30));
});

test("merk, model en uitvoering: de keuzelijsten volgen elkaar", () => {
  assert.ok(brands().includes("Nissan"));
  assert.ok(modelsOf("Nissan").includes("Leaf"));
  const v = variantsOf("Nissan", "Leaf");
  assert.ok(v.length >= 3);
  assert.ok(v[0]!.year! >= v[v.length - 1]!.year!); // nieuwste eerst
  assert.equal(evById(v[0]!.id), v[0]);
  assert.equal(evById("bestaat-niet"), null);
});

test("een geschatte auto: titel uit de uitvoering, schatting blijft gemarkeerd na opslaan en lezen", () => {
  const ev = matchEv(LEAF_RDW)[0]!;
  const auto = { id: "x", label: "", plate: null, rdw: null, start: estimateStart(ev), ev: ev.id };
  assert.equal(carTitle(auto), "Nissan Leaf");
  const [terug] = parseCars(JSON.stringify([auto]));
  assert.equal(terug!.start?.estimated, true);
  assert.equal(terug!.ev, ev.id);
  // een door jou ingevulde waarde is geen schatting
  const [zelf] = parseCars(JSON.stringify([{ ...auto, start: { ratePpPerHour: 9, kmPerPp: 2 } }]));
  assert.equal(zelf!.start?.estimated, undefined);
});

const round1 = (n: number): number => Math.round(n * 10) / 10;

test("estimateFromKwh: een auto die niet in de tabel staat, uit alleen zijn accu", () => {
  const s = estimateFromKwh(26);
  assert.equal(s.estimated, true);
  assert.equal(s.ratePpPerHour, round1((3.5 * 0.85 * 100) / 26));
  assert.equal(s.kmPerPp, round1(26 / 17)); // 17 kWh/100 km is een aanname
});

test("measureRate: twee aflezingen in één beurt, omgerekend naar 16 A", () => {
  const min = 60_000;
  assert.equal(measureRate(120 * min, 40, 60, 16), 10); // 20 pp in 2 uur
  assert.equal(measureRate(120 * min, 40, 50, 8), 10); // 5 pp/u op 8 A is 10 op 16 A
  assert.equal(measureRate(29 * min, 40, 60, 16), null); // minder dan een half uur
  assert.equal(measureRate(120 * min, 40, 41, 16), null); // minder dan twee procentpunt
  assert.equal(measureRate(120 * min, 40, 99, 16), null); // afgekapt tegen vol
  assert.equal(measureRate(60 * min, 40, 90, 16), null); // 50 pp/uur kan niet
  assert.equal(measureRate(120 * min, 60, 40, 16), null); // teruggelopen
});

test("een gemeten snelheid zonder bekend bereik: bereik blijft onbekend, de snelheid telt", () => {
  const start = { ratePpPerHour: 9, kmPerPp: 0, measured: true };
  assert.equal(ratePerHour([], 16, start).value, 9);
  assert.equal(kmPerPp([], start).source, "onbekend");
  const [terug] = parseCars(JSON.stringify([{ id: "x", label: "", start }]));
  assert.deepEqual(terug!.start, start);
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
