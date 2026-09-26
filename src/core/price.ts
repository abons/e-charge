/**
 * De stroomprijs per kwartier, en wat een laadbeurt daarmee kost.
 *
 * Zonneplan heeft geen open API, maar rekent een vaste opbouw bovenop de EPEX day-ahead-prijs — en
 * díe is publiek. Dus: de marktprijs per kwartier (excl. btw) plus de inkoopvergoeding van Zonneplan
 * plus de energiebelasting, en over dat geheel 21% btw. De vaste maandbedragen (levering, netbeheer)
 * hangen niet aan een laadbeurt en tellen hier niet mee.
 *
 * ⚠️ **De drie constanten hieronder zijn de enige plek met tariefkennis**, net als de vier in
 * `charge.ts` de enige plek met autokennis zijn. Ze staan op de tariefkaart van Zonneplan en in de
 * belastingtabel; verandert een van beide, dan verandert hier één getal. Een andere leverancier is
 * een andere opslag, meer niet — het kwartiermodel is bij elk dynamisch contract hetzelfde.
 *
 * Alles hier is puur: wat er van het net komt (`parseEnergyZero`) en wat er uit opslag komt
 * (`parseQuarters`) wordt niet vertrouwd, en de kostensom werkt op tijdstippen in ms — de
 * kwartieren komen als UTC-momenten binnen en het scherm maakt er lokale klok van.
 */

/** Inkoopvergoeding van Zonneplan bij een dynamisch contract, per kWh excl. btw (sept 2026). */
export const SUPPLIER_MARKUP_EUR_PER_KWH = 0.01652;
/** Energiebelasting elektriciteit 2026, eerste twee schijven (tot 10.000 kWh), per kWh excl. btw. */
export const ENERGY_TAX_EUR_PER_KWH = 0.09161;
export const VAT = 1.21;

/** Van marktprijs (excl. btw) naar wat er op de rekening staat, per kWh. */
export function allInEurPerKwh(marketExclVat: number): number {
  return (marketExclVat + SUPPLIER_MARKUP_EUR_PER_KWH + ENERGY_TAX_EUR_PER_KWH) * VAT;
}

/** Eén kwartier (of een ander blok) met zijn all-in prijs; `endMs` is exclusief. */
export interface Quarter {
  startMs: number;
  endMs: number;
  eurPerKwh: number;
}

const HOUR_MS = 60 * 60_000;

/**
 * Het antwoord van `public.api.energyzero.nl/public/v1/prices` met `interval=INTERVAL_QUARTER`:
 * `base[]` is de kale marktprijs (excl. btw, zonder opslag of belasting — gecontroleerd tegen de
 * EPEX-prijs van Energy-Charts op 2026-09-25), per blok met `start`, `end` en `price.value`. Die
 * waarde is een *string* ("0.19701"). Eén aanroep met de datum van vandaag geeft gisteren, vandaag
 * en — vanaf ±13:00 — morgen.
 *
 * Een blok langer dan een uur is geen kwartier- of uurprijs en telt niet mee: liever geen prijs dan
 * één dagprijs als kwartier verkopen. Dubbele starts vallen weg (de laatste wint), onzin ook.
 */
export function parseEnergyZero(json: unknown): Quarter[] {
  if (typeof json !== "object" || json === null) return [];
  const base = (json as Record<string, unknown>)["base"];
  if (!Array.isArray(base)) return [];
  const byStart = new Map<number, Quarter>();
  for (const row of base) {
    if (typeof row !== "object" || row === null) continue;
    const { start, end, price } = row as Record<string, unknown>;
    if (typeof start !== "string" || typeof end !== "string" || typeof price !== "object" || price === null) continue;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    // Alleen een echt getal of een niet-lege string: `Number(null)` en `Number("")` zijn 0, en een
    // blok "à 0 cent" is erger dan een ontbrekend blok — dat wordt tenminste opnieuw opgehaald.
    const raw = (price as Record<string, unknown>)["value"];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(value)) continue;
    if (endMs <= startMs || endMs - startMs > HOUR_MS) continue;
    byStart.set(startMs, { startMs, endMs, eurPerKwh: allInEurPerKwh(value) });
  }
  return [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
}

/** Wat er in `localStorage` bewaard staat: dezelfde vorm als [Quarter], maar niet te vertrouwen. */
export function parseQuarters(value: unknown): Quarter[] {
  if (!Array.isArray(value)) return [];
  const out: Quarter[] = [];
  for (const q of value) {
    if (typeof q !== "object" || q === null) continue;
    const { startMs, endMs, eurPerKwh } = q as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof endMs !== "number" || typeof eurPerKwh !== "number") continue;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(eurPerKwh)) continue;
    if (startMs <= 0 || endMs <= startMs) continue;
    out.push({ startMs, endMs, eurPerKwh });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Nieuwe blokken over de oude heen, en alles ouder dan [keepFromMs] weg. Een oud blok dat een nieuw
 * blok ook maar raakt, verdwijnt — niet alleen bij gelijke start: verandert de bron ooit van
 * bloklengte, dan telt een uurblok bovenop drie achtergebleven kwartierblokken anders zeven
 * kwartieren energie in één uur.
 */
export function mergeQuarters(oud: Quarter[], nieuw: Quarter[], keepFromMs: number): Quarter[] {
  const overlapt = (a: Quarter, b: Quarter): boolean => a.startMs < b.endMs && b.startMs < a.endMs;
  const rest = oud.filter((o) => !nieuw.some((n) => overlapt(o, n)));
  return [...rest, ...nieuw].filter((q) => q.endMs > keepFromMs).sort((a, b) => a.startMs - b.startMs);
}

export interface Cost {
  /** Wat de hele laadbeurt kost; het onbekende deel is geschat op de gemiddelde bekende prijs. */
  eur: number;
  /** Gemiddelde all-in prijs over het bekende deel, €/kWh. */
  avgEurPerKwh: number;
  /** `true` als elk moment van de laadbeurt een bekende prijs heeft. */
  complete: boolean;
  coveredMs: number;
  totalMs: number;
}

/**
 * Wat laden van [startMs] tot [endMs] kost, aan [powerKw] uit de muur, bij deze kwartierprijzen.
 *
 * Het vermogen is constant (geen taper, zie `charge.ts`), dus elk kwartier levert `powerKw × ¼ uur`
 * kWh aan de prijs van dát kwartier; een begin of eind midden in een kwartier telt naar rato. Valt
 * een deel van de laadbeurt buiten de bekende prijzen (de prijzen van morgen komen pas rond 13:00),
 * dan schat dat deel op de gemiddelde prijs van wat wél bekend is, en zegt `complete` dat het een
 * schatting is. Zonder één bekend kwartier valt er niets te zeggen: `null`.
 */
export function chargingCost(startMs: number, endMs: number, powerKw: number, quarters: Quarter[]): Cost | null {
  const totalMs = Math.max(0, endMs - startMs);
  let eur = 0;
  let coveredMs = 0;
  for (const q of quarters) {
    const overlap = Math.min(endMs, q.endMs) - Math.max(startMs, q.startMs);
    if (overlap <= 0) continue;
    eur += (powerKw * overlap * q.eurPerKwh) / HOUR_MS;
    coveredMs += overlap;
  }
  if (coveredMs <= 0 || powerKw <= 0) return null;
  const avgEurPerKwh = eur / ((powerKw * coveredMs) / HOUR_MS);
  const uncoveredMs = Math.max(0, totalMs - coveredMs);
  return {
    eur: eur + (powerKw * uncoveredMs * avgEurPerKwh) / HOUR_MS,
    avgEurPerKwh,
    complete: uncoveredMs === 0,
    coveredMs,
    totalMs,
  };
}

/**
 * Wat een kilometer kost bij deze gemiddelde prijs: het verbruik uit `charge.ts` (per 100 km, uit
 * de accu) gedeeld door het rendement (want je betaalt wat er uit de muur komt), maal de prijs.
 * Bij 20 ct/kWh, 17 kWh/100 km en 88% is dat 3,9 ct/km. Gerekend, niet gemeten — de gemeten
 * tegenhanger staat in `npm run calibrate`, uit twee opeenvolgende regels in `log.md`. Zonder
 * rendement valt er niets te rekenen: `null`, geen 0 — nul is een bedrag.
 */
export function eurPerKm(avgEurPerKwh: number, consumptionKwhPer100Km: number, efficiency: number): number | null {
  if (!(efficiency > 0)) return null;
  return (avgEurPerKwh * consumptionKwhPer100Km) / 100 / efficiency;
}

/** Of elk moment van [startMs, endMs) een bekende prijs heeft — dan hoeft er niets opgehaald. */
export function covered(startMs: number, endMs: number, quarters: Quarter[]): boolean {
  if (endMs <= startMs) return true;
  const cost = chargingCost(startMs, endMs, 1, quarters);
  return cost !== null && cost.complete;
}
