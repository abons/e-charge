import { RATED_CURRENT_A, clampCurrent, powerKwAt, type Setup } from "./charge.js";
import type { Entry } from "./logbook.js";

/**
 * Alles wat de app weet over de auto, afgeleid uit het logboek — en niets anders.
 *
 * Twee grootheden, allebei in eenheden die het logboek rechtstreeks geeft (percentage, klok, km-stand),
 * zodat er geen capaciteit of rendement aan te pas komt:
 *
 * - **Laadsnelheid**: procentpunt per uur, per laadstand. Per beurt (eind% − start%) ÷ uren, daarna de
 *   mediaan over de laatste [WINDOW] bruikbare beurten.
 * - **Kilometers per procentpunt**: uit twee opeenvolgende regels, (km van de volgende − km van deze)
 *   ÷ (eind% van deze − start% van de volgende), gepoold over de laatste [WINDOW] geldige paren.
 *
 * ⚠️ Een beurt telt alleen mee als zijn getallen **afgelezen** zijn (`estimated` is niet gezet) en niet
 * afgekapt: de app bewaart ook beurten zonder aflezing, maar die bevatten haar eigen schatting, en een
 * mediaan over haar eigen schatting bevestigt alleen zichzelf. Beurten die op 99–100% eindigen tellen
 * niet voor de snelheid: de lader was daar eerder klaar dan je afkoppelde, dus de duur is een bovengrens.
 *
 * ⚠️ Met te weinig bruikbare beurten gelden de startwaarden hieronder — hard schakelen, geen gewogen
 * gemiddelde. Een test legt vast dat ze overeenkomen met wat deze functies uit `log.md` afleiden, zodat
 * ze niet ongemerkt uit elkaar lopen.
 */

/** Procentpunt per uur op de hoogste stand ([RATED_CURRENT_A]), afgeleid uit `log.md` (2026-10-06). */
export const START_RATE_PP_PER_H = 10.1;
/** Kilometers per procentpunt, afgeleid uit vier geldige paren in `log.md` (2026-10-06): 2,01. */
export const START_KM_PER_PP = 2.0;

/**
 * Startwaarden van één auto: wat het scherm gebruikt zolang het logboek van die auto te weinig
 * beurten heeft. ⚠️ Ze zijn van die auto en niet van "een" auto: de Leaf-waarden hierboven komen uit
 * het logboek van déze Leaf. Een andere auto heeft ze alleen als de eigenaar ze zelf invult; anders is
 * `start` `null` en is de snelheid onbekend (`source: "onbekend"`) tot er eigen beurten zijn.
 */
export interface Start {
  /** Procentpunt per uur op de hoogste stand. */
  ratePpPerHour: number;
  /** Kilometers per procentpunt. */
  kmPerPp: number;
  /** `true` als dit uit accugrootte en verbruik is geschat (`evest.ts`) en niet door de eigenaar is gemeten of ingevuld. */
  estimated?: boolean;
  /** `true` als de snelheid in de eerste beurt van deze auto is gemeten (`measureRate`), en geen schatting meer is. */
  measured?: boolean;
}

/** De startwaarden van de Leaf van de eigenaar — de default, zodat scripts en tests ongewijzigd blijven. */
export const LEAF_START: Start = { ratePpPerHour: START_RATE_PP_PER_H, kmPerPp: START_KM_PER_PP };

/** Bruikbare beurten op de hoogste stand voordat die de startwaarde vervangen. */
export const MIN_SESSIONS = 3;
/** Op een lagere stand volstaan er twee eigen beurten: de schaling uit de hoogste stand is zelf al een rekenregel. */
export const MIN_SESSIONS_OTHER = 2;
/** Geldige paren voor de kilometers per procentpunt. */
export const MIN_PAIRS = 3;
/** Alleen de laatste zoveel beurten (paren) tellen mee, zodat seizoen en slijtage meelopen. */
export const WINDOW = 8;

const HOUR_MS = 3_600_000;

/** Eerste meting binnen één beurt: minstens een half uur en twee procentpunt tussen twee aflezingen. */
export const MEASURE_MIN_MS = 30 * 60_000;
export const MEASURE_MIN_PP = 2;

/**
 * De laadsnelheid uit twee aflezingen van het dashboard binnen één beurt, omgerekend naar de hoogste
 * stand (net als `ratePerHour` een lagere stand schaalt). Alleen voor een auto die nog geen eigen
 * logboek heeft: een meting van een uur is grover dan de mediaan van drie beurten, maar echter dan
 * een schatting uit de accugrootte. `null` als de twee aflezingen te dicht bij elkaar liggen, de lader
 * al bijna klaar was (afgekapt) of de uitkomst onwaarschijnlijk is.
 */
export function measureRate(elapsedMs: number, fromPercent: number, toPercent: number, amps: number): number | null {
  const pp = toPercent - fromPercent;
  if (elapsedMs < MEASURE_MIN_MS || pp < MEASURE_MIN_PP || toPercent > 98) return null;
  const rate = pp / (elapsedMs / HOUR_MS);
  if (!(rate >= 0.5 && rate <= 30)) return null;
  return Math.round(((rate * RATED_CURRENT_A) / clampCurrent(amps)) * 10) / 10;
}
const DAY_MS = 24 * HOUR_MS;

/** Waar een getal vandaan komt: je eigen logboek, een schaling uit de hoogste stand, of een startwaarde. */
export type Source = "eigen" | "schaling" | "start" | "onbekend";

export interface Value {
  value: number;
  /** Aantal beurten (of paren) waar `value` op rust; 0 bij een startwaarde. */
  n: number;
  source: Source;
}

/** De mediaan; `NaN` voor een lege lijst. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const ampsOf = (e: Entry): number => e.amps ?? RATED_CURRENT_A;

/**
 * De laadsnelheid van één beurt in procentpunt per uur, of `null` als de beurt er niets over zegt:
 * een geschatte aflezing, minder dan 10 procentpunt of korter dan een uur (te grof), langer dan 12 uur
 * (een tikfout of een vergeten stekker) of een eind boven 98% (afgekapt).
 */
export function rateOf(e: Entry): number | null {
  if (e.estimated === true) return null;
  const pp = e.toPercent - e.fromPercent;
  const hours = (e.endMs - e.startMs) / HOUR_MS;
  if (pp < 10 || hours < 1 || hours > 12 || e.toPercent > 98) return null;
  return pp / hours;
}

/** De bruikbare snelheden op stand [amps], oudste eerst, de laatste [WINDOW], zonder uitschieters. */
export function rateSamples(entries: Entry[], amps: number): number[] {
  const samples = [...entries]
    .sort((a, b) => a.startMs - b.startMs)
    .filter((e) => ampsOf(e) === amps)
    .map(rateOf)
    .filter((r): r is number => r !== null)
    .slice(-WINDOW);
  if (samples.length < 3) return samples;
  // Een beurt die half of dubbel zo snel ging als de rest is een vergissing in de invoer, geen auto.
  const m = median(samples);
  return samples.filter((r) => r >= m * 0.5 && r <= m * 2);
}

/**
 * De laadsnelheid op stand [amps]. Eigen beurten op die stand winnen; zonder die schaalt de snelheid
 * van de hoogste stand mee met de kabelverhouding (8 A is de helft) — en het scherm zegt dat het dat is.
 */
export function ratePerHour(entries: Entry[], amps: number, start: Start | null = LEAF_START): Value {
  const stand = clampCurrent(amps);
  const own = rateSamples(entries, stand);
  if (own.length >= (stand === RATED_CURRENT_A ? MIN_SESSIONS : MIN_SESSIONS_OTHER)) {
    return { value: median(own), n: own.length, source: "eigen" };
  }
  if (stand === RATED_CURRENT_A) {
    return start === null
      ? { value: NaN, n: 0, source: "onbekend" }
      : { value: start.ratePpPerHour, n: 0, source: "start" };
  }
  const top = ratePerHour(entries, RATED_CURRENT_A, start);
  if (top.source === "onbekend") return top;
  return { value: (top.value * stand) / RATED_CURRENT_A, n: top.n, source: "schaling" };
}

/** Eén rit tussen twee opeenvolgende beurten: van afkoppelen (`fromMs`) tot de volgende start (`toMs`). */
export interface Interval {
  km: number;
  pp: number;
  fromMs: number;
  toMs: number;
  /** `true` als een van de twee beurten een geschat eind% of km-stand heeft: getoond, nooit meegeteld. */
  estimated: boolean;
}

/** Waarom een rit tussen twee regels niet in de grafiek staat. */
export type SkipReason = "geen km" | "te kort" | "te lang";

/** Eén rit tussen twee regels: de rit zelf, of waarom die niet telt. */
/**
 * Eén rit over een reeks regels: de eerste en de laatste hebben een km-stand, de regels ertussen
 * (zonder km-stand) zijn bijladen onderweg. De procentpunten zijn dan de som van wat er tussen elke twee
 * opeenvolgende regels is verbruikt, en de week-grens geldt per stuk. Een reeks van twee is een gewone rit.
 */
function intervalOf(chain: Entry[]): Interval | SkipReason {
  const a = chain[0]!;
  const b = chain[chain.length - 1]!;
  if (a.km === null || b.km === null) return "geen km";
  let pp = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const gap = chain[i + 1]!.startMs - chain[i]!.endMs;
    if (gap < 0 || gap > 7 * DAY_MS) return "te lang";
    pp += chain[i]!.toPercent - chain[i + 1]!.fromPercent;
  }
  const km = b.km - a.km;
  if (km < 10 || pp < 10) return "te kort";
  return { km, pp, fromMs: a.endMs, toMs: b.startMs, estimated: chain.some((e) => e.estimated === true) };
}

/** Alle geldige ritten met afgelezen getallen, oudste eerst, nog zonder venster en zonder uitschieters. */
export function kmPerPpIntervals(entries: Entry[]): Interval[] {
  return skippedAndIntervals(entries).intervals.filter((i) => !i.estimated);
}

/**
 * Alle ritten met een km-stand, ook die met een geschat getal (`estimated`), en per reden hoeveel er
 * zijn afgevallen; samen één per twee opeenvolgende regels. Alleen de grafiek toont de geschatte.
 */
export function skippedAndIntervals(entries: Entry[]): { intervals: Interval[]; skipped: Record<SkipReason, number> } {
  const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);
  const intervals: Interval[] = [];
  const skipped: Record<SkipReason, number> = { "geen km": 0, "te kort": 0, "te lang": 0 };
  // Regels zonder km-stand voor de eerste en na de laatste met km hebben niets om een rit mee te rekenen.
  const ankers = sorted.flatMap((e, i) => (e.km === null ? [] : [i]));
  skipped["geen km"] += ankers.length === 0 ? Math.max(0, sorted.length - 1) : ankers[0]! + (sorted.length - 1 - ankers[ankers.length - 1]!);
  for (let k = 0; k + 1 < ankers.length; k++) {
    const r = intervalOf(sorted.slice(ankers[k]!, ankers[k + 1]! + 1));
    if (typeof r === "string") skipped[r]++;
    else intervals.push(r);
  }
  return { intervals, skipped };
}

/** De geldige paren (km per procentpunt) uit opeenvolgende regels, oudste eerst, de laatste [WINDOW]. */
export function kmPerPpPairs(entries: Entry[]): Interval[] {
  const last = kmPerPpIntervals(entries).slice(-WINDOW);
  if (last.length < 3) return last;
  // Een rit waar de auto elders is bijgeladen (of een km-stand die niet klopt) valt ver buiten de rest.
  const m = median(last.map((p) => p.km / p.pp));
  return last.filter((p) => p.km / p.pp >= m / 1.35 && p.km / p.pp <= m * 1.35);
}

/** Kilometers per procentpunt: gepoold over de geldige paren (Σkm ÷ Σpp), anders de startwaarde. */
export function kmPerPp(entries: Entry[], start: Start | null = LEAF_START): Value {
  const pairs = kmPerPpPairs(entries);
  if (pairs.length < MIN_PAIRS) {
    // `kmPerPp` 0 is "onbekend": een snelheid die in de eerste beurt gemeten is, heeft nog geen bereik.
    return start === null || !(start.kmPerPp > 0)
      ? { value: NaN, n: 0, source: "onbekend" }
      : { value: start.kmPerPp, n: 0, source: "start" };
  }
  const km = pairs.reduce((s, p) => s + p.km, 0);
  const pp = pairs.reduce((s, p) => s + p.pp, 0);
  return { value: km / pp, n: pairs.length, source: "eigen" };
}

/** Wat `estimate`, `percentAfter`, `rangeKm` en de kosten nodig hebben, op stand [amps]. */
export function setupAt(amps: number, entries: Entry[], start: Start | null = LEAF_START): Setup {
  return {
    // `NaN` is "onbekend": `estimate` en `eurPerKm` lezen dat al als "niets te rekenen"; het scherm zegt het in woorden.
    ratePpPerHour: ratePerHour(entries, amps, start).value,
    powerKw: powerKwAt(amps),
    kmPerPp: kmPerPp(entries, start).value,
  };
}
