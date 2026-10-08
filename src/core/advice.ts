import { chargingCost, type Quarter } from "./price.js";

/**
 * Het startadvies: wanneer begint een laadbeurt van deze lengte het goedkoopst, binnen de prijzen
 * die al bekend zijn? Dezelfde kostensom als de kostenregel (`chargingCost`), alleen verschoven over
 * de kwartiergrenzen vanaf nu. Puur: de klok en de prijzen komen binnen als getallen.
 *
 * Alleen vensters die helemaal geprijsd zijn tellen: een schatting op de gemiddelde prijs (wat de
 * kostenregel doet voor morgen vóór 13:00) zou het advies naar het onbekende stuk trekken als dat
 * toevallig onder het gemiddelde ligt.
 */

const QUARTER_MS = 15 * 60_000;
/** Onder dit verschil is wachten de moeite niet: dan zegt het advies "nu". */
export const MIN_SAVING_EUR = 0.05;

/** Zonder "klaar vóór" adviseert de app nooit een beurt die later dan een etmaal na nu klaar is. */
export const DEFAULT_HORIZON_MS = 24 * 60 * 60_000;

/**
 * Het moment waarop de auto klaar moet zijn: het eerstvolgende [hour]:00 lokale tijd na [nowMs], of
 * zonder uur een etmaal na nu. Lokale tijd via de datumconstructor, zoals in `time.ts`: op de dag
 * van de klokwissel is een etmaal geen 24 uur.
 */
export function readyBy(nowMs: number, hour: number | null): number {
  if (hour === null) return nowMs + DEFAULT_HORIZON_MS;
  const d = new Date(nowMs);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime();
  return today > nowMs ? today : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hour).getTime();
}

export interface Advice {
  /** Het goedkoopste startmoment; gelijk aan `nowMs` als nu starten (bijna) net zo goedkoop is. */
  startMs: number;
  endMs: number;
  eur: number;
  /** Wat dezelfde beurt kost als je nu insteekt. */
  nowEur: number;
  /** `nowEur - eur` in hele centen (zoals op het scherm), en 0 als het advies "nu" is. */
  savingEur: number;
  /** `true` als zelfs nu starten niet vóór de deadline klaar is; het advies is dan nu. */
  tooLate: boolean;
}

const centen = (eur: number): number => Math.round(eur * 100) / 100;

/**
 * Het goedkoopste start voor [durationMs] laden aan [powerKw], vanaf [nowMs]: nu, of een van de
 * kwartiergrenzen erna, zolang de hele beurt in bekende prijzen valt en vóór [latestEndMs] klaar is.
 * `null` als zelfs nu starten niet helemaal geprijsd is — dan valt er niets te vergelijken.
 *
 * Bij gelijke kosten wint de vroegste: een advies dat je een uur laat wachten voor een cent is geen
 * advies. Scheelt het minder dan [MIN_SAVING_EUR], dan is het advies nu. Haalt zelfs nu starten de
 * deadline niet, dan ook — met `tooLate`.
 */
export function cheapestStart(
  nowMs: number,
  durationMs: number,
  powerKw: number,
  quarters: Quarter[],
  latestEndMs = Number.POSITIVE_INFINITY,
): Advice | null {
  if (!(durationMs > 0) || !(powerKw > 0) || quarters.length === 0) return null;
  const nu = chargingCost(nowMs, nowMs + durationMs, powerKw, quarters);
  if (nu === null || !nu.complete) return null;
  let best = { startMs: nowMs, eur: nu.eur };
  const lastEndMs = Math.min(quarters[quarters.length - 1]!.endMs, latestEndMs);
  for (let s = Math.ceil(nowMs / QUARTER_MS) * QUARTER_MS; s + durationMs <= lastEndMs; s += QUARTER_MS) {
    if (s === nowMs) continue;
    const c = chargingCost(s, s + durationMs, powerKw, quarters);
    // Een gat in de prijzen midden in het venster: overslaan, niet stoppen — erna kan het weer kloppen.
    if (c === null || !c.complete) continue;
    // Een tiende cent marge, zodat afrondingsruis geen later kwartier laat winnen.
    if (c.eur < best.eur - 0.001) best = { startMs: s, eur: c.eur };
  }
  // Op hele centen vergelijken en aftrekken: dan klopt "je bespaart" met de twee bedragen ervoor.
  if (centen(nu.eur) - centen(best.eur) < MIN_SAVING_EUR - 0.001) best = { startMs: nowMs, eur: nu.eur };
  return {
    startMs: best.startMs,
    endMs: best.startMs + durationMs,
    eur: best.eur,
    nowEur: nu.eur,
    savingEur: centen(centen(nu.eur) - centen(best.eur)),
    tooLate: nowMs + durationMs > latestEndMs,
  };
}
