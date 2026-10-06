import { LEAF_START, type Start } from "./derive.js";
import { evById } from "./evest.js";

/**
 * De auto's op deze telefoon. Puur: opslag en netwerk zitten in `main.ts` en `car.ts` (de map erboven).
 *
 * ⚠️ **Het kenteken is een zoeksleutel en een label, geen gegeven dat de app gebruikt om te rekenen.**
 * Wat RDW teruggeeft (merk, model, uitvoering, bouwjaar) is alleen om te tonen: capaciteit en
 * laadsnelheid komen nog steeds uit het logboek van die auto. Het kenteken blijft in `localStorage` en
 * gaat alleen bij "Zoek" in de URL naar RDW; het staat nooit in een export (`log.md` staat in een
 * publieke repo).
 */
export interface Rdw {
  merk: string;
  model: string;
  uitvoering: string;
  /** Bouwjaar uit `datum_eerste_toelating` ("20150919"), of `null` als dat veld ontbreekt of niet klopt. */
  jaar: number | null;
  voertuigsoort: string;
}

export interface Car {
  /** Sleutel van de opslag: `leaf` voor de auto van vóór de autokeuze, anders het genormaliseerde kenteken. */
  id: string;
  /** Wat bovenin staat. */
  label: string;
  /** Genormaliseerd (`AB123C`), zonder streepjes. */
  plate: string | null;
  rdw: Rdw | null;
  /** Startwaarden die de eigenaar zelf invulde; `null` = onbekend tot er eigen beurten zijn. */
  start: Start | null;
  /** De uitvoering uit de tabel (`evest.ts`) waar de schatting op rust; `null` als er geen is gekozen. */
  ev: string | null;
}

/** De auto van vóór de autokeuze: de Leaf van de eigenaar, met zijn startwaarden uit `log.md`. */
export const FIRST_CAR_ID = "car";
/** Zo heette de eerste auto in de eerste versie van de autokeuze; opgeslagen lijsten worden bij het lezen omgezet. */
const LEGACY_FIRST_CAR_ID = "leaf";

export const CARS_KEY = "e-charge.cars";
export const CAR_KEY = "e-charge.car";
/** Gezet als laatste stap van de adoptie; zonder marker pakt hij de oude sleutels opnieuw op. */
export const MIGRATED_KEY = "e-charge.migrated";

/** Hoofdletters en cijfers, de rest (streepjes, spaties, punten) weg. */
export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Een kenteken is zes letters/cijfers; of het een bestaand kenteken is zegt alleen RDW. */
export function isPlate(normalized: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalized);
}

/**
 * Met streepjes zoals op de plaat: de klasse van de eerste twee tekens bepaalt de plek van de streepjes.
 * Onbekende combinaties blijven zonder streepjes — liever kaal dan fout.
 */
export function formatPlate(normalized: string): string {
  if (!isPlate(normalized)) return normalized;
  const kind = [...normalized].map((c) => (/[0-9]/.test(c) ? "9" : "X")).join("");
  const patterns: Record<string, readonly number[]> = {
    XX9999: [2, 4], "99XX99": [2, 4], "9999XX": [2, 4], XXXX99: [2, 4], "99XXXX": [2, 4], XX99XX: [2, 4],
    "99XXX9": [2, 5], "9XXX99": [1, 4], XX999X: [2, 5], X999XX: [1, 4],
    XXX99X: [3, 5], X99XXX: [1, 3], "9XX999": [1, 3], "999XX9": [3, 5],
  };
  const cuts = patterns[kind];
  if (cuts === undefined) return normalized;
  return [normalized.slice(0, cuts[0]), normalized.slice(cuts[0], cuts[1]), normalized.slice(cuts[1])].join("-");
}

const tekst = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "NISSAN" wordt "Nissan", "LEAF ZE1" blijft "Leaf ZE1": alleen woorden zonder cijfers krijgen hoofdletter + klein. */
function nette(v: string): string {
  return v
    .split(" ")
    .map((w) => (/[0-9]/.test(w) || w.length <= 3 ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Het antwoord van RDW (`m9d7-ebf2`): een lijst met nul of één voertuig, alles strings en hoofdletters.
 * `null` bij een lege lijst of een antwoord dat er niet uitziet als een voertuig. Geen enkel veld is
 * verplicht behalve het merk: een voertuig zonder handelsbenaming is een voertuig.
 */
export function parseRdw(json: unknown): Rdw | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const o = json[0] as unknown;
  if (typeof o !== "object" || o === null) return null;
  const r = o as Record<string, unknown>;
  const merk = tekst(r["merk"]);
  if (merk === "") return null;
  const datum = tekst(r["datum_eerste_toelating"]);
  const jaar = /^\d{8}$/.test(datum) ? Number(datum.slice(0, 4)) : null;
  // RDW zet het merk vaak ook in de handelsbenaming ("NISSAN LEAF 40KWH"); één keer is genoeg.
  const benaming = tekst(r["handelsbenaming"]);
  const zonderMerk = benaming.toUpperCase().startsWith(merk.toUpperCase() + " ") ? benaming.slice(merk.length + 1).trim() : benaming;
  return {
    merk: nette(merk),
    model: nette(zonderMerk),
    uitvoering: tekst(r["uitvoering"]),
    jaar,
    voertuigsoort: tekst(r["voertuigsoort"]),
  };
}

/** De tekst voor de autoregel: `Nissan Leaf · AB-123-C`; zonder RDW-gegevens het eigen label. */
export function carTitle(car: Car): string {
  const ev = evById(car.ev);
  // RDW weet het beste hoe de auto heet; zonder kenteken is dat de gekozen uitvoering, en anders de eigen naam.
  const naam =
    car.label !== "" && car.rdw === null
      ? car.label
      : car.rdw !== null
        ? `${car.rdw.merk} ${car.rdw.model}`.trim()
        : ev !== null
          ? `${ev.brand} ${ev.model}`
          : car.label;
  const kenteken = car.plate === null ? "" : ` · ${formatPlate(car.plate)}`;
  return (naam === "" ? "Auto" : naam) + kenteken;
}

const getal = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseStart(v: unknown): Start | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const rate = getal(o["ratePpPerHour"]);
  const km = getal(o["kmPerPp"]);
  // `km` 0 is toegestaan: de snelheid is gemeten, het bereik nog niet bekend.
  if (rate === null || km === null || !(rate > 0) || !(km >= 0)) return null;
  const start: Start = { ratePpPerHour: rate, kmPerPp: km };
  if (o["estimated"] === true) start.estimated = true;
  if (o["measured"] === true) start.measured = true;
  return start;
}

function parseRdwStored(v: unknown): Rdw | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const merk = tekst(o["merk"]);
  if (merk === "") return null;
  return { merk, model: tekst(o["model"]), uitvoering: tekst(o["uitvoering"]), jaar: getal(o["jaar"]), voertuigsoort: tekst(o["voertuigsoort"]) };
}

/** De lijst uit opslag; kapotte regels en dubbele id's vallen stil weg. */
export function parseCars(raw: string | null): Car[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cars: Car[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const stored = tekst(o["id"]);
    const id = stored === LEGACY_FIRST_CAR_ID ? FIRST_CAR_ID : stored;
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    const plate = tekst(o["plate"]);
    cars.push({
      id,
      label: tekst(o["label"]),
      plate: isPlate(plate) ? plate : null,
      rdw: parseRdwStored(o["rdw"]),
      start: parseStart(o["start"]),
      ev: tekst(o["ev"]) === "" ? null : tekst(o["ev"]),
    });
  }
  return cars;
}

/** De actieve auto: de bewaarde als die bestaat, anders de eerste. `null` alleen bij een lege lijst. */
export function activeCar(cars: Car[], id: string | null): Car | null {
  return cars.find((c) => c.id === id) ?? cars[0] ?? null;
}

/** Opslagsleutel van een per-auto-ding. De Leaf-auto houdt de oude sleutels, dus geen kopie bij adoptie. */
export function carKey(kind: "logbook" | "session" | "finished", carId: string): string {
  return carId === FIRST_CAR_ID ? `e-charge.${kind}` : `e-charge.${kind}.${carId}`;
}

/** Een nieuwe auto van een kenteken (en wat RDW erover zei). Dezelfde plaat twee keer is dezelfde auto. */
export function carFromPlate(plate: string, rdw: Rdw | null, label: string): Car {
  return { id: plate, label: label.trim(), plate, rdw, start: null, ev: null };
}

/** Voeg toe of vervang op `id`; de volgorde blijft zoals ze was. */
export function withCar(cars: Car[], car: Car): Car[] {
  return cars.some((c) => c.id === car.id) ? cars.map((c) => (c.id === car.id ? car : c)) : [...cars, car];
}

export function withoutCar(cars: Car[], id: string): Car[] {
  return cars.filter((c) => c.id !== id);
}

/**
 * Wat er bij de eerste start na deze update gebeurt: de bestaande, onversleutelde opslag *is* de
 * Leaf. Omdat `carKey` voor `leaf` de oude sleutels teruggeeft hoeft er niets gekopieerd — alleen de
 * auto zelf moet in de lijst. Idempotent, en raakt geen bestaande lijst aan.
 *
 * ⚠️ Niet doen bij een lijst die al bestaat, óók niet als `leaf` er niet in staat: wie de Leaf
 * bewust verwijderde wil hem niet bij de volgende start terug. Daarom de marker.
 */
export function adoptLegacy(cars: Car[], migrated: boolean, hasLegacyData: boolean): { cars: Car[]; changed: boolean } {
  // ⚠️ Alleen de Leaf van de eigenaar erft zijn startwaarden, en alleen als er oude opslag van hem
  // staat. Een verse browser heeft nog geen auto: die kiest hij zelf, en tot dan is de snelheid onbekend.
  if (migrated || cars.length > 0 || !hasLegacyData) return { cars, changed: false };
  return {
    cars: [{ id: FIRST_CAR_ID, label: "Nissan Leaf", plate: null, rdw: null, start: { ...LEAF_START }, ev: null }],
    changed: true,
  };
}
