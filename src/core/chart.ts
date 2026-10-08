import type { Quarter } from "./price.js";
import { clock, dayLabel } from "./time.js";

/**
 * De prijsgrafiek in de modal achter "Goedkoopste start": de all-in kwartierprijs als trap, met de
 * laadbeurt van nu en die van het advies als banden eronder. Puur — een SVG-string plus de schaal,
 * zodat `main.ts` er een vinger op kan leggen (kruisdraad en uitlezing) zonder zelf te rekenen.
 *
 * Eén reeks, dus geen legenda voor de lijn; de twee banden hebben er wel een (in de HTML). Kleuren
 * zijn de tokens van het scherm: groen accent voor de lijn en het advies, grijs voor "nu".
 */

export const CHART_W = 340;
export const CHART_H = 190;
const PAD_L = 30;
const PAD_R = 10;
const PAD_T = 26;
const PAD_B = 24;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;
const HOUR_MS = 60 * 60_000;

export interface Band {
  startMs: number;
  endMs: number;
  kind: "nu" | "advies";
}

export interface PriceChart {
  svg: string;
  /** Van viewBox-x naar tijdstip, geklemd op het bereik van de grafiek. */
  msAt(viewX: number): number;
  x(ms: number): number;
  y(eurPerKwh: number): number;
  /** Het kwartier dat [ms] bevat, of `null` in een gat. */
  quarterAt(ms: number): Quarter | null;
}

const ct = (eurPerKwh: number): number => Math.round(eurPerKwh * 100);
/** Tekst in de grafiek krijgt een rand in de kaartkleur, zodat de lijn eronder hem niet doorstreept. */
const HALO = `fill="#eee" stroke="#1c1c1d" stroke-width="3" paint-order="stroke"`;
const f = (n: number): string => n.toFixed(1);

/** Lokaal heel uur op of na [ms] — via de datum, want een uur is in lokale tijd geen vast getal ms. */
function nextHour(ms: number): number {
  const d = new Date(ms);
  const h = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  return h < ms ? h + HOUR_MS : h;
}

/**
 * De grafiek vanaf het begin van het huidige uur tot een uur na [untilMs] (het eind van wat het advies
 * mocht kiezen), of tot het laatste bekende kwartier als dat eerder is. Wat erna komt hoort niet bij de
 * keuze, en een laagste prijs die je niet kunt halen is geen informatie. [deadlineMs] tekent "klaar
 * vóór" als stippellijn. `null` zonder één kwartier na [nowMs] — dan is er niets te tekenen.
 */
export function priceChart(
  quarters: Quarter[],
  nowMs: number,
  bands: Band[],
  untilMs: number,
  deadlineMs: number | null = null,
): PriceChart | null {
  const d = new Date(nowMs);
  const fromMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  const limitMs = nextHour(untilMs) + HOUR_MS;
  const shown = quarters.filter((q) => q.endMs > fromMs && q.startMs < limitMs);
  if (shown.length === 0 || shown[shown.length - 1]!.endMs <= nowMs) return null;
  const toMs = shown[shown.length - 1]!.endMs;

  const cts = shown.map((q) => q.eurPerKwh * 100);
  const hi = Math.max(...cts);
  const lo = Math.min(...cts);
  const step = hi - Math.min(lo, 0) > 50 ? 20 : 10;
  const yMax = Math.max(step, Math.ceil(hi / step) * step);
  const yMin = lo < 0 ? Math.floor(lo / step) * step : 0;

  const x = (ms: number): number => PAD_L + ((Math.min(Math.max(ms, fromMs), toMs) - fromMs) / (toMs - fromMs)) * PLOT_W;
  const y = (eurPerKwh: number): number => PAD_T + ((yMax - eurPerKwh * 100) / (yMax - yMin)) * PLOT_H;
  const quarterAt = (ms: number): Quarter | null => shown.find((q) => q.startMs <= ms && ms < q.endMs) ?? null;
  const msAt = (viewX: number): number =>
    Math.min(toMs - 1, Math.max(fromMs, fromMs + ((viewX - PAD_L) / PLOT_W) * (toMs - fromMs)));

  const parts: string[] = [];
  const bottom = PAD_T + PLOT_H;

  // Rasterlijnen en y-labels: recessief, de lijn is wat je leest.
  for (let v = yMin; v <= yMax; v += step) {
    const yy = y(v / 100);
    parts.push(`<line x1="${PAD_L}" x2="${CHART_W - PAD_R}" y1="${f(yy)}" y2="${f(yy)}" stroke="#2c2c2e"/>`);
    parts.push(`<text x="${PAD_L - 6}" y="${f(yy + 4)}" text-anchor="end" fill="#8a8a8a" font-size="11">${v}</text>`);
  }

  // De banden onder de lijn: eerst "nu", dan het advies eroverheen.
  for (const kind of ["nu", "advies"] as const) {
    for (const b of bands.filter((b) => b.kind === kind)) {
      const x1 = x(b.startMs);
      const x2 = x(b.endMs);
      if (x2 - x1 < 0.5) continue;
      const fill = kind === "advies" ? `fill="#7fd4a0" fill-opacity="0.22"` : `fill="#9a9a9a" fill-opacity="0.16"`;
      parts.push(`<rect x="${f(x1)}" y="${PAD_T}" width="${f(x2 - x1)}" height="${PLOT_H}" ${fill}/>`);
    }
  }

  // Middernacht: een stippellijn met het woordje van de dag erna, zoals "morgen".
  for (let h = nextHour(fromMs); h < toMs; h = nextHour(h + 1)) {
    const hd = new Date(h);
    const xx = x(h);
    if (hd.getHours() === 0) {
      parts.push(`<line x1="${f(xx)}" x2="${f(xx)}" y1="${PAD_T - 14}" y2="${bottom}" stroke="#5a5a5c" stroke-dasharray="2 3"/>`);
      const label = dayLabel(nowMs, h) ?? "";
      if (xx + 4 < CHART_W - PAD_R - 30) parts.push(`<text x="${f(xx + 4)}" y="${PAD_T - 4}" fill="#9a9a9a" font-size="11">${label}</text>`);
    }
    if (hd.getHours() % 3 === 0) {
      parts.push(`<line x1="${f(xx)}" x2="${f(xx)}" y1="${bottom}" y2="${bottom + 4}" stroke="#5a5a5c"/>`);
      parts.push(`<text x="${f(xx)}" y="${bottom + 16}" text-anchor="middle" fill="#9a9a9a" font-size="11">${String(hd.getHours()).padStart(2, "0")}</text>`);
    }
  }

  // De trap: elk kwartier een horizontaal stuk, verticaal naar het volgende; een gat begint opnieuw.
  let line = "";
  let area = "";
  let prevEnd = Number.NaN;
  let segStartX = 0;
  const base = f(y(Math.max(0, yMin / 100)));
  const closeArea = (endX: number) => (area += ` L${f(endX)},${base} L${f(segStartX)},${base} Z`);
  for (const q of shown) {
    const x1 = x(q.startMs);
    const x2 = x(q.endMs);
    const yy = f(y(q.eurPerKwh));
    if (q.startMs !== prevEnd) {
      if (line !== "") closeArea(x(prevEnd));
      line += `M${f(x1)},${yy}`;
      area += `M${f(x1)},${yy}`;
      segStartX = x1;
    } else {
      line += ` V${yy}`;
      area += ` V${yy}`;
    }
    line += ` H${f(x2)}`;
    area += ` H${f(x2)}`;
    prevEnd = q.endMs;
  }
  closeArea(x(prevEnd));
  parts.push(`<path d="${area}" fill="#7fd4a0" fill-opacity="0.08"/>`);
  parts.push(`<path d="${line}" fill="none" stroke="#7fd4a0" stroke-width="2" stroke-linejoin="round"/>`);

  // Laagste en hoogste prijs vanaf nu: twee labels, niet een getal op elk kwartier.
  const ahead = shown.filter((q) => q.endMs > nowMs && q.startMs < Math.max(untilMs, nowMs + 1));
  const min = ahead.reduce((a, q) => (q.eurPerKwh < a.eurPerKwh ? q : a));
  const max = ahead.reduce((a, q) => (q.eurPerKwh > a.eurPerKwh ? q : a));
  for (const q of min === max ? [min] : [min, max]) {
    const xx = Math.min(CHART_W - PAD_R - 18, Math.max(PAD_L + 18, (x(q.startMs) + x(q.endMs)) / 2));
    parts.push(`<text x="${f(xx)}" y="${f(y(q.eurPerKwh) - 7)}" text-anchor="middle" ${HALO} font-size="12" font-weight="700">${ct(q.eurPerKwh)} ct</text>`);
  }

  // "Klaar vóór": een stippellijn met de tijd erbij, onderin waar de labels van min en max niet staan.
  if (deadlineMs !== null && deadlineMs > fromMs && deadlineMs < toMs) {
    const xd = x(deadlineMs);
    parts.push(`<line x1="${f(xd)}" x2="${f(xd)}" y1="${PAD_T}" y2="${bottom}" stroke="#eee" stroke-dasharray="4 3"/>`);
    // Links van de lijn, tenzij daar geen ruimte is.
    const links = xd - PAD_L > 60;
    parts.push(
      `<text x="${f(links ? xd - 4 : xd + 4)}" y="${bottom - 6}" text-anchor="${links ? "end" : "start"}" ` +
        `${HALO} font-size="11">vóór ${clock(deadlineMs)}</text>`,
    );
  }

  // Nu: een lijn en een stip op de prijs van dit kwartier.
  const xn = x(nowMs);
  parts.push(`<line x1="${f(xn)}" x2="${f(xn)}" y1="${PAD_T}" y2="${bottom}" stroke="#eee" stroke-opacity="0.5"/>`);
  const qNu = quarterAt(nowMs);
  if (qNu !== null) parts.push(`<circle cx="${f(xn)}" cy="${f(y(qNu.eurPerKwh))}" r="4" fill="#121213" stroke="#eee" stroke-width="2"/>`);

  // Kruisdraad voor de vinger; `main.ts` zet hem neer en weer weg.
  parts.push(`<line id="pc-cross" x1="0" x2="0" y1="${PAD_T}" y2="${bottom}" stroke="#eee" visibility="hidden"/>`);
  parts.push(`<circle id="pc-dot" cx="0" cy="0" r="5" fill="#7fd4a0" stroke="#1c1c1d" stroke-width="2" visibility="hidden"/>`);

  const svg =
    `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" width="100%" role="img" aria-label="Stroomprijs per kwartier" ` +
    `font-family="system-ui, sans-serif" style="display:block;touch-action:pan-y">${parts.join("")}</svg>`;
  return { svg, msAt, x, y, quarterAt };
}
