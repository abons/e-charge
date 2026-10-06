import { clampCurrent } from "./charge.js";
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

/**
 * De laadstand in de `opm`-kolom: `16 A`. Geen eigen kolom (de kolomvolgorde is een contract), dus
 * dit paar ís het contract: de app schrijft met [noteForAmps], `calibrate` en `kosten` lezen met
 * [ampsFromNote], en een test legt vast dat ze elkaars omgekeerde zijn. Verandert het formaat ooit,
 * dan verandert het hier — en nergens anders.
 */
export function noteForAmps(amps: number): string {
  return `${clampCurrent(amps)} A`;
}

/**
 * De opmerking van een beurt: de stand, en `geschat` als `eind%` niet van het dashboard is afgelezen
 * maar door de app is uitgerekend. Zo'n regel blijft in het logboek (km en tijden zijn echt), maar
 * telt niet mee voor de laadsnelheid en het bereik — zie `derive.ts`. Staat ook zo in `log.md`.
 */
export function noteFor(amps: number | null, estimated: boolean): string | undefined {
  const delen: string[] = [];
  if (amps !== null) delen.push(noteForAmps(amps));
  if (estimated) delen.push("geschat");
  return delen.length === 0 ? undefined : delen.join("; ");
}

/**
 * Of een `opm` zegt dat de regel niet zuiver gemeten is: `geschat` (een getal uit de rekenkern, of een
 * tijd bij benadering) of `elders geladen` (de auto heeft tussen twee regels ergens anders gehangen,
 * dus het verbruik tussen die regels klopt niet).
 */
export function isUnreliableNote(note: string): boolean {
  return /geschat|elders geladen/i.test(note);
}

/**
 * De stand die in [note] geschreven staat, of `null` als er geen staat (een regel van vóór de
 * standenkeuze, of `elders geladen` zonder meer). Wat er staat wordt níét geklemd: `12 A` is een
 * stand die de knop niet heeft, en dat hoort de lezer te melden in plaats van stil 16 A te rekenen
 * — `clampCurrent` zegt of het er een is. Een decimaal (`12.5 A`) leest als 12,5 en niet als 5.
 */
export function ampsFromNote(note: string): number | null {
  const m = /(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*A\b/.exec(note);
  return m === null ? null : Number(m[1]!.replace(",", "."));
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
