import { WINDOW, kmPerPpIntervals, kmPerPpPairs, skippedAndIntervals, type Interval, type SkipReason } from "./derive.js";
import type { Entry } from "./logbook.js";

/**
 * De verbruiksgrafiek in de modal op het tabblad Loggen: per rit tussen twee laadbeurten een staaf met
 * de kilometers per procentpunt (hoger is zuiniger), met het gepoolde gemiddelde als stippellijn.
 * Puur — een SVG-string plus de ritten erachter, zodat `main.ts` een tik op een staaf kan uitlezen.
 *
 * Dezelfde ritten als `kmPerPp` in `derive.ts` (`kmPerPpIntervals`): wat daar ongeldig is (geschat,
 * zonder km-stand, <10 km of <10 pp, meer dan een week ertussen) staat hier ook niet. Een rit die wel
 * geldig is maar door de uitschieterfilter valt telt niet mee voor het bereik en staat dus gedempt.
 */

export const USAGE_W = 340;
export const USAGE_H = 170;
const PAD_L = 30;
const PAD_R = 10;
const PAD_T = 18;
const PAD_B = 24;
const PLOT_W = USAGE_W - PAD_L - PAD_R;
const PLOT_H = USAGE_H - PAD_T - PAD_B;
/** Meer staven dan dit worden te smal voor een vinger; de oudste vallen af. */
export const MAX_BARS = 12;

export interface UsageBar extends Interval {
  kmPerPp: number;
  /** `false` voor een geschatte rit, een van vóór de laatste [WINDOW] ritten of een buiten 1,35× de mediaan: getoond, niet meegeteld. */
  counted: boolean;
  /** `true` voor een afgelezen rit die ouder is dan de laatste [WINDOW]: het bereik kijkt er niet meer naar. */
  old: boolean;
}

export interface UsageChart {
  svg: string;
  bars: UsageBar[];
  /** Gepoold gemiddelde over de meegetelde ritten in beeld, `null` zonder. */
  mean: number | null;
}

const f = (n: number): string => n.toFixed(1);

/** De ritten voor de grafiek, oudste eerst, hooguit [MAX_BARS]. */
export function usageBars(entries: Entry[]): UsageBar[] {
  const counted = new Set(kmPerPpPairs(entries).map((p) => p.fromMs));
  const venster = kmPerPpIntervals(entries).slice(-WINDOW)[0]?.fromMs ?? Infinity;
  return skippedAndIntervals(entries)
    .intervals.slice(-MAX_BARS)
    .map((i) => ({ ...i, kmPerPp: i.km / i.pp, counted: counted.has(i.fromMs), old: !i.estimated && i.fromMs < venster }));
}

/** Hoeveel ritten er tussen de beurten zijn en waarom sommige ontbreken, in woorden voor de modal. */
export function usageSkipNote(entries: Entry[]): string {
  const { intervals, skipped } = skippedAndIntervals(entries);
  const totaal = intervals.length + Object.values(skipped).reduce((s, n) => s + n, 0);
  const uitleg: [SkipReason, string][] = [
    ["geen km", "zonder km-stand"],
    ["te kort", "onder 10 km of 10 procentpunt"],
    ["te lang", "meer dan een week ertussen"],
    ["overlap", "beurten die overlappen"],
  ];
  const redenen = uitleg.filter(([r]) => skipped[r] > 0).map(([r, t]) => `${skipped[r]} ${t}`);
  const schat = intervals.filter((i) => i.estimated).length;
  const hidden = Math.max(0, intervals.length - MAX_BARS);
  const extra = hidden > 0 ? `${hidden} oudere niet getoond` : "";
  const alle = [...redenen, extra].filter((s) => s !== "");
  return (
    `${Math.min(intervals.length, MAX_BARS)} van ${totaal} ritten getoond` +
    (schat > 0 ? `, ${schat} daarvan grijs omdat een eind% of km-stand geschat is` : "") +
    (alle.length > 0 ? `; afgevallen: ${alle.join(", ")}` : "") +
    "."
  );
}

/** `null` zonder één geldige rit: dan valt er niets te tekenen. */
export function usageChart(entries: Entry[]): UsageChart | null {
  const bars = usageBars(entries);
  if (bars.length === 0) return null;
  const used = bars.filter((b) => b.counted);
  const mean = used.length === 0 ? null : used.reduce((s, b) => s + b.km, 0) / used.reduce((s, b) => s + b.pp, 0);

  const hi = Math.max(...bars.map((b) => b.kmPerPp), mean ?? 0);
  const step = hi > 5 ? 2 : 1;
  const yMax = Math.max(step, Math.ceil(hi / step) * step);
  const y = (v: number): number => PAD_T + ((yMax - v) / yMax) * PLOT_H;
  const bottom = PAD_T + PLOT_H;
  const slot = PLOT_W / Math.max(bars.length, 4);
  const w = slot * 0.7;

  const parts: string[] = [];
  for (let v = 0; v <= yMax; v += step) {
    parts.push(`<line x1="${PAD_L}" x2="${USAGE_W - PAD_R}" y1="${f(y(v))}" y2="${f(y(v))}" stroke="#2c2c2e"/>`);
    parts.push(`<text x="${PAD_L - 6}" y="${f(y(v) + 4)}" text-anchor="end" fill="#8a8a8a" font-size="11">${v}</text>`);
  }
  bars.forEach((b, i) => {
    const x = PAD_L + i * slot + (slot - w) / 2;
    const top = y(b.kmPerPp);
    const fill = b.counted ? `fill="#7fd4a0"` : `fill="#9a9a9a" fill-opacity="0.45"`;
    // Een brede onzichtbare strook eronder: een staaf van 20 px breed is voor een vinger te smal.
    parts.push(`<rect class="ub" data-i="${i}" x="${f(PAD_L + i * slot)}" y="${PAD_T}" width="${f(slot)}" height="${PLOT_H}" fill="transparent"/>`);
    parts.push(`<rect id="ub-${i}" x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(bottom - top)}" rx="2" ${fill} pointer-events="none"/>`);
    const d = new Date(b.toMs);
    parts.push(
      `<text x="${f(x + w / 2)}" y="${bottom + 16}" text-anchor="middle" fill="#9a9a9a" font-size="11" pointer-events="none">` +
        `${d.getDate()}/${d.getMonth() + 1}</text>`,
    );
  });
  if (mean !== null) {
    parts.push(`<line x1="${PAD_L}" x2="${USAGE_W - PAD_R}" y1="${f(y(mean))}" y2="${f(y(mean))}" stroke="#eee" stroke-dasharray="4 3" pointer-events="none"/>`);
    parts.push(
      `<text x="${USAGE_W - PAD_R}" y="${f(y(mean) - 4)}" text-anchor="end" font-size="11" fill="#eee" stroke="#1c1c1d" stroke-width="3" paint-order="stroke" pointer-events="none">` +
        `gemiddeld ${mean.toFixed(2).replace(".", ",")}</text>`,
    );
  }
  const svg =
    `<svg viewBox="0 0 ${USAGE_W} ${USAGE_H}" width="100%" role="img" aria-label="Kilometers per procentpunt per rit" ` +
    `font-family="system-ui, sans-serif" style="display:block">${parts.join("")}</svg>`;
  return { svg, bars, mean };
}

