import { maxMeterKwh } from "./charge.js";
import { logRow, type LogEntry } from "./logline.js";

/**
 * Het logboek zoals de app het bewaart: een lijst afgesloten laadbeurten, op deze telefoon.
 *
 * ⚠️ **Dit is een kladblok, geen archief.** `localStorage` overleeft een herstart en een update van
 * de app, maar niet het wissen van websitegegevens, een nieuwe telefoon of een andere browser.
 * `log.md` in de repo blijft de duurzame kopie; deze module bestaat om het plakken daarheen tot één
 * knop terug te brengen, niet om het overbodig te maken.
 *
 * Alles hier is puur en defensief: wat uit opslag komt is niet te vertrouwen (een oudere versie van
 * de app, een half geschreven waarde, iemand die het met de hand bewerkte), dus onbruikbare regels
 * vallen weg in plaats van het scherm mee te slepen.
 */
export interface Entry {
  startMs: number;
  endMs: number;
  fromPercent: number;
  toPercent: number;
  km: number | null;
  kwh: number | null;
  /** Kosten van de beurt in euro's, uit de kwartierprijzen op het moment van bewaren. */
  eur: number | null;
}

const getal = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Eén opgeslagen regel, of `null` als er niets bruikbaars in zit. */
function parseEntry(value: unknown): Entry | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  const startMs = getal(o["startMs"]);
  const endMs = getal(o["endMs"]);
  const fromPercent = getal(o["fromPercent"]);
  const toPercent = getal(o["toPercent"]);
  if (startMs === null || endMs === null || fromPercent === null || toPercent === null) return null;
  if (startMs <= 0 || endMs < startMs) return null;
  return { startMs, endMs, fromPercent, toPercent, km: getal(o["km"]), kwh: getal(o["kwh"]), eur: getal(o["eur"]) };
}

/** De hele lijst uit opslag, oudste eerst; kapotte regels vallen stil weg. */
export function parseEntries(raw: string | null): Entry[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.map(parseEntry).filter((e): e is Entry => e !== null).sort((a, b) => a.startMs - b.startMs);
}

/**
 * Dezelfde laadbeurt twee keer bewaren is makkelijker dan het lijkt — de knop staat er nu eenmaal,
 * en na een herstart van de app is de afgelopen sessie er nog steeds. Gelijke start telt als gelijk.
 *
 * ⚠️ Een leeg veld overschrijft geen ingevuld getal. Dat is precies de beloofde route: 's avonds
 * bewaren mét kilometerstand, 's ochtends de meterstand erbij zetten — en dan zijn de invoervelden
 * intussen leeg. Zonder deze samenvoeging gooide die tweede druk op de knop de km-stand weg. Een
 * fout getal corrigeer je door de regel te verwijderen (×) en opnieuw te bewaren.
 *
 * ⚠️ Het bedrag hoort bij het einde van de beurt: een `eur` van een tussentijdse bewaring (twee uur
 * laden, € 1,20) mag niet blijven staan naast de `eind%` en `endMs` van de hele nacht, want
 * `calibrate` maakt daar een prijs per kWh van die eruitziet als een meting. Alleen bij hetzelfde
 * `endMs` vult een leeg bedrag het bewaarde aan — dan is het dezelfde beurt zonder prijzen bij de hand.
 */
export function withEntry(entries: Entry[], entry: Entry): Entry[] {
  const oud = entries.find((e) => e.startMs === entry.startMs);
  const samen: Entry =
    oud === undefined
      ? entry
      : {
          ...entry,
          km: entry.km ?? oud.km,
          kwh: entry.kwh ?? oud.kwh,
          eur: entry.eur ?? (oud.endMs === entry.endMs ? oud.eur : null),
        };
  const zonder = entries.filter((e) => e.startMs !== entry.startMs);
  return [...zonder, samen].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Wat er als meterstand bewaard staat maar er geen kán zijn, was een aflezing van het dashboard: het
 * logboek vroeg tot 2026-09-13 om kWh van de meter, en het scherm toont nergens een kWh, dus het
 * enige getal dat je op dat moment in je hand had was het percentage. Die waarden verhuizen hier
 * eenmalig naar `eind%`, waar ze horen.
 *
 * ⚠️ Alleen wat de lader er in die laadbeurt niet doorheen kán hebben geduwd én een geldig
 * percentage is. Een echte meterstand blijft dus staan, en een getal dat geen van beide kan zijn
 * (300) ook — dat verwijder je met de hand, want raden is hier erger dan laten staan.
 */
export function withMeterAsPercent(entries: Entry[]): Entry[] {
  return entries.map((e) => {
    if (e.kwh === null || e.kwh <= maxMeterKwh(e.endMs - e.startMs)) return e;
    if (e.kwh > 100 || e.kwh < e.fromPercent) return e;
    return { ...e, toPercent: Math.round(e.kwh), kwh: null };
  });
}

export function withoutEntry(entries: Entry[], startMs: number): Entry[] {
  return entries.filter((e) => e.startMs !== startMs);
}

/** De tabelregels voor `log.md`, oudste eerst — precies wat je daar onder de kop plakt. */
export function toMarkdown(entries: Entry[]): string {
  return entries
    .map((e) =>
      logRow({
        startMs: e.startMs,
        endMs: e.endMs,
        fromPercent: e.fromPercent,
        toPercent: e.toPercent,
        km: e.km,
        kwh: e.kwh,
        eur: e.eur,
      } satisfies LogEntry),
    )
    .join("\n");
}
