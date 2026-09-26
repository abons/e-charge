import { clock, number as nl } from "./time.js";

/**
 * Eén regel voor `log.md`, kant-en-klaar om te plakken. De app schrijft nergens naartoe — dit is
 * tekst op je klembord, meer niet — maar zonder deze regel wordt een logboek 's avonds in een
 * donkere schuur toch niet ingevuld, en dan blijven de constanten geschat.
 *
 * De kolomvolgorde is die van `log.md` en mag niet uit elkaar lopen: `scripts/calibrate.mjs` leest
 * op positie, niet op naam. De test pint het formaat vast.
 */
export interface LogEntry {
  /** Het moment van insteken; bepaalt ook de datum van de regel. */
  startMs: number;
  /** Het moment van afkoppelen. */
  endMs: number;
  fromPercent: number;
  toPercent: number;
  /** Kilometerstand bij insteken — leeg is prima, alleen het verbruik valt dan niet te rekenen. */
  km?: number | null;
  /** Wat de meter over deze periode telde; vul je meestal later in. */
  kwh?: number | null;
  /** Wat de beurt kostte bij Zonneplan, uit de kwartierprijzen — de app vult dit bij het bewaren. */
  eur?: number | null;
  note?: string;
}

/** `yyyy-mm-dd` in lokale tijd, net als de klok — dit is geen contract tussen apparaten. */
function isoDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const cel = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === "" ? "" : String(v);

export function logRow(entry: LogEntry): string {
  const kolommen = [
    isoDate(entry.startMs),
    cel(entry.km),
    cel(Math.round(entry.fromPercent)),
    cel(Math.round(entry.toPercent)),
    clock(entry.startMs),
    clock(entry.endMs),
    // Met een komma, zoals de rest van `log.md` en zoals je het intypt; calibrate.mjs neemt beide aan.
    entry.kwh === null || entry.kwh === undefined ? "" : nl(entry.kwh),
    entry.eur === null || entry.eur === undefined ? "" : nl(entry.eur, 2),
    cel(entry.note),
  ];
  return `| ${kolommen.join(" | ")} |`;
}
