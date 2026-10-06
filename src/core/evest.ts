import { CHARGE_POWER_KW } from "./charge.js";
import type { Start } from "./derive.js";
import { EV_ROWS } from "./evtable.js";
import type { Rdw } from "./car.js";

/**
 * Een startwaarde voor een auto die nog geen logboek heeft, uit zijn accugrootte en verbruik.
 *
 * ⚠️ **Dit is een schatting, geen meting, en het scherm zegt dat** (`Start.estimated`). Gemeten tegen de
 * Leaf van de eigenaar (2026-10-06): de snelheid kwam 23% te laag uit (7,8 tegen 10,2 procentpunt per uur)
 * en het bereik 16% te hoog (2,3 tegen 2,0 km per procentpunt). Dat is de veilige kant: de auto lijkt
 * trager dan hij is. Zodra het logboek van die auto drie beurten heeft, telt alleen dat nog.
 *
 * Bron: open-ev-data (MIT), meegebundeld in `evtable.ts`; de app haalt hem nooit op.
 */
export interface Ev {
  id: string;
  brand: string;
  model: string;
  variant: string;
  year: number | null;
  /** Bruikbare accu in kWh. */
  kwh: number;
  /** Verbruik in de praktijk, kWh per 100 km. */
  consumption: number;
  /** Wat de boordlader aan wisselstroom aankan, kW; `null` onbekend. */
  acKw: number | null;
}

/**
 * Het deel van de stroom uit de muur dat in de accu komt. ⚠️ Een aanname: de boordlader en de accu
 * houden onderweg warmte over. 85% is wat de Leaf van de eigenaar (met een versleten accu) nog het
 * dichtst benadert aan de veilige kant; het wordt vervangen door het eerste afgelezen logboek.
 */
export const CHARGE_EFFICIENCY = 0.85;

export const EVS: readonly Ev[] = EV_ROWS.map(([id, brand, model, variant, year, kwh, consumption, acKw]) => ({
  id,
  brand,
  model,
  variant,
  year,
  kwh,
  consumption,
  acKw,
}));

/** Alle merken, alfabetisch. */
export function brands(): string[] {
  return [...new Set(EVS.map((e) => e.brand))].sort((a, b) => a.localeCompare(b));
}

export function modelsOf(brand: string): string[] {
  return [...new Set(EVS.filter((e) => e.brand === brand).map((e) => e.model))].sort((a, b) => a.localeCompare(b));
}

/** De uitvoeringen van een model, nieuwste jaar eerst en dan de kleinste accu. */
export function variantsOf(brand: string, model: string): Ev[] {
  return EVS.filter((e) => e.brand === brand && e.model === model).sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.kwh - b.kwh,
  );
}

export function evById(id: string | null): Ev | null {
  return id === null ? null : (EVS.find((e) => e.id === id) ?? null);
}

/** `Leaf 40 kWh (2017)`: wat in de keuzelijst staat. */
export function evLabel(e: Ev): string {
  return `${e.variant === "" ? `${e.kwh} kWh` : e.variant}${e.year === null ? "" : ` (${e.year})`}`;
}

/** De startwaarden voor deze uitvoering, gemarkeerd als schatting. */
export function estimateStart(ev: Ev): Start {
  // Aan een stopcontact van ~3,5 kW is de auto zelden de beperking, maar een boordlader van 3,3 kW is het wel.
  const powerKw = ev.acKw === null ? CHARGE_POWER_KW : Math.min(CHARGE_POWER_KW, ev.acKw);
  return {
    ratePpPerHour: round1((powerKw * CHARGE_EFFICIENCY * 100) / ev.kwh),
    kmPerPp: round1(ev.kwh / ev.consumption),
    estimated: true,
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const simple = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** De getallen in een tekst vóór "kwh" ("LEAF 40KWH" geeft 40). */
function kwhIn(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*kwh/i.exec(text);
  return m === null ? null : Number((m[1] as string).replace(",", "."));
}

/**
 * De uitvoeringen die bij een RDW-antwoord passen, de beste eerst. RDW en open-ev-data noemen een
 * auto niet hetzelfde ("NISSAN" / "LEAF 40KWH" tegen "Nissan" / "Leaf" / "40 kWh"), dus er wordt op
 * merk, op de modelnaam als los woord en op de accugrootte uit de benaming gematcht, daarna op
 * bouwjaar. Leeg als het merk of het model niet in de tabel staat.
 */
export function matchEv(rdw: Rdw | null): Ev[] {
  if (rdw === null) return [];
  const brand = simple(rdw.merk);
  const words = new Set(simple(`${rdw.model} ${rdw.uitvoering}`).split(" "));
  const wantKwh = kwhIn(`${rdw.model} ${rdw.uitvoering}`);
  const scored: { ev: Ev; score: number }[] = [];
  for (const ev of EVS) {
    if (simple(ev.brand) !== brand) continue;
    const model = simple(ev.model).split(" ");
    if (!model.every((w) => words.has(w))) continue;
    let score = 1;
    if (wantKwh !== null && Math.abs(ev.kwh - wantKwh) <= 2.5) score += 4;
    if (wantKwh !== null && Math.abs(ev.kwh - wantKwh) > 2.5) score -= 2;
    if (rdw.jaar !== null && ev.year !== null) score += Math.max(0, 2 - Math.abs(ev.year - rdw.jaar) / 2);
    scored.push({ ev, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.ev);
}
