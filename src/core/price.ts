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
 * Alles hier is puur: wat er van het net komt (`parseEnergyZero`, `parseEnergyCharts`) en wat er
 * uit opslag komt (`parseQuarters`) wordt niet vertrouwd, en de kostensom werkt op tijdstippen in
 * ms — de kwartieren komen als UTC-momenten binnen en het scherm maakt er lokale klok van.
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

const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;

/**
 * Van losse (start, marktprijs)-punten naar aaneengesloten blokken. De bloklengte is de kleinste
 * stap van hooguit een uur tussen twee punten, zodat een bron die toch per uur levert niet
 * stilletjes driekwart van de tijd onbedekt laat, en een gat aan het begin de maat niet bepaalt.
 * Zonder tweede punt is een kwartier de aanname. Zijn er wél meer punten maar liggen ze allemaal
 * verder dan een uur uit elkaar (een dagreeks), dan is dit geen kwartierprijs en telt de bron niet
 * mee — liever de volgende bron dan één prijs per dag als kwartier verkopen. Dubbele starts vallen
 * weg (de laatste wint), en wat geen getal is ook.
 */
function toQuarters(points: Array<{ startMs: number; eurPerKwh: number }>): Quarter[] {
  const byStart = new Map<number, number>();
  for (const p of points) {
    if (Number.isFinite(p.startMs) && Number.isFinite(p.eurPerKwh) && p.startMs > 0) byStart.set(p.startMs, p.eurPerKwh);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < starts.length; i++) {
    const d = (starts[i] ?? 0) - (starts[i - 1] ?? 0);
    if (d > 0 && d <= HOUR_MS && d < step) step = d;
  }
  if (step === Infinity) {
    if (starts.length > 1) return [];
    step = QUARTER_MS;
  }
  return starts.map((startMs) => ({ startMs, endMs: startMs + step, eurPerKwh: byStart.get(startMs) ?? 0 }));
}

/**
 * Het antwoord van `api.energyzero.nl/v1/energyprices` met `inclBtw=false`: `Prices[].price` is de
 * marktprijs in €/kWh excl. btw, `readingDate` het begin van het blok als ISO-tijd in UTC.
 */
export function parseEnergyZero(json: unknown): Quarter[] {
  if (typeof json !== "object" || json === null) return [];
  const prices = (json as Record<string, unknown>)["Prices"];
  if (!Array.isArray(prices)) return [];
  const points: Array<{ startMs: number; eurPerKwh: number }> = [];
  for (const row of prices) {
    if (typeof row !== "object" || row === null) continue;
    const { price, readingDate } = row as Record<string, unknown>;
    if (typeof price !== "number" || typeof readingDate !== "string") continue;
    points.push({ startMs: Date.parse(readingDate), eurPerKwh: allInEurPerKwh(price) });
  }
  return toQuarters(points);
}

/**
 * Het antwoord van `api.energy-charts.info/price?bzn=NL` (Fraunhofer ISE, CC BY 4.0): twee even
 * lange rijen, `unix_seconds` en `price` in €/MWh excl. btw.
 */
export function parseEnergyCharts(json: unknown): Quarter[] {
  if (typeof json !== "object" || json === null) return [];
  const { unix_seconds: seconds, price } = json as Record<string, unknown>;
  if (!Array.isArray(seconds) || !Array.isArray(price)) return [];
  const points: Array<{ startMs: number; eurPerKwh: number }> = [];
  for (let i = 0; i < Math.min(seconds.length, price.length); i++) {
    const s = seconds[i];
    const p = price[i];
    if (typeof s !== "number" || typeof p !== "number") continue;
    points.push({ startMs: s * 1000, eurPerKwh: allInEurPerKwh(p / 1000) });
  }
  return toQuarters(points);
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
 * blok ook maar raakt, verdwijnt — niet alleen bij gelijke start: de twee bronnen kunnen in
 * bloklengte verschillen, en een uurblok bovenop drie achtergebleven kwartierblokken telt anders
 * zeven kwartieren energie in één uur.
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

/** Of elk moment van [startMs, endMs) een bekende prijs heeft — dan hoeft er niets opgehaald. */
export function covered(startMs: number, endMs: number, quarters: Quarter[]): boolean {
  if (endMs <= startMs) return true;
  const cost = chargingCost(startMs, endMs, 1, quarters);
  return cost !== null && cost.complete;
}
