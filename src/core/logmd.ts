import { clampCurrent } from "./charge.js";
import type { Entry } from "./logbook.js";
import { ampsFromNote, isUnreliableNote } from "./logline.js";

/**
 * De tabel in `log.md` als lijst regels — de inverse van `logRow`. Dit is geen app-code (de app leest
 * `log.md` nooit zelf), maar `scripts/calibrate.mjs`, `scripts/kosten.mjs` en de tests lezen er het
 * logboek mee in, zodat ze dezelfde afleiding (`derive.ts`) gebruiken als de app en niet een kopie.
 *
 * Tijden zijn lokale klok, net als overal in deze repo. Een regel met te weinig cellen, een ontbrekend
 * percentage of een stand die de knop niet heeft wordt niet geraden maar overgeslagen, en staat in
 * [skipped] zodat de lezer het kan melden.
 */
export interface ParsedLog {
  entries: Entry[];
  skipped: { datum: string; reden: string }[];
}

const KOLOMMEN = 9; // datum, km, start%, eind%, van, tot, kWh, €, opm — het contract met logline.ts

const nummer = (s: string): number | null => {
  const tekst = s.trim().replace(",", ".");
  // Een lege kolom is geen nul: `Number("")` is 0 en eindig.
  if (tekst === "") return null;
  const v = Number(tekst);
  return Number.isFinite(v) ? v : null;
};

export function parseLogMd(text: string): ParsedLog {
  const entries: Entry[] = [];
  const skipped: { datum: string; reden: string }[] = [];
  const rows = text
    // Weggecommentarieerde voorbeeldregels beginnen ook met een `|`, en zijn geen sessies.
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((r) => r.trim().startsWith("|"))
    .map((r) => r.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[0] ?? ""));

  for (const c of rows) {
    const datum = c[0]!;
    if (c.length !== KOLOMMEN) {
      skipped.push({ datum, reden: `${c.length} kolommen, ${KOLOMMEN} verwacht` });
      continue;
    }
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum)!;
    const klok = (t: string, extraDagen = 0): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(t);
      return m === null
        ? null
        : new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + extraDagen, Number(m[1]), Number(m[2])).getTime();
    };
    const startMs = klok(c[4]!);
    let endMs = klok(c[5]!);
    if (startMs === null || endMs === null) {
      skipped.push({ datum, reden: "onleesbare tijd" });
      continue;
    }
    // `tot` vóór `van` is over middernacht.
    if (endMs < startMs) endMs = klok(c[5]!, 1)!;
    const fromPercent = nummer(c[2]!);
    const toPercent = nummer(c[3]!);
    if (fromPercent === null || toPercent === null) {
      skipped.push({ datum, reden: "start% of eind% ontbreekt" });
      continue;
    }
    const opm = c[8]!;
    const geschreven = ampsFromNote(opm);
    if (geschreven !== null && clampCurrent(geschreven) !== geschreven) {
      skipped.push({ datum, reden: `stand ${geschreven} A bestaat niet op de knop` });
      continue;
    }
    entries.push({
      startMs,
      endMs,
      fromPercent,
      toPercent,
      km: nummer(c[1]!),
      kwh: nummer(c[6]!),
      eur: nummer(c[7]!),
      amps: geschreven,
      estimated: isUnreliableNote(opm),
    });
  }
  return { entries: entries.sort((a, b) => a.startMs - b.startMs), skipped };
}
