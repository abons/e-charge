import { clampCurrent, maxMeterKwh } from "./charge.js";
import { logRow, noteForAmps, type LogEntry } from "./logline.js";

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
  /**
   * De laadstand van de kabel in ampère; `null` voor beurten van vóór de standenkeuze (2026-09-27),
   * die allemaal op de hoogste stand gingen. Gaat als `16 A` de `opm`-kolom in — geen eigen kolom,
   * want de kolomvolgorde is een contract met `calibrate`, en `opm` was al vrije tekst.
   */
  amps: number | null;
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
  return {
    startMs,
    endMs,
    fromPercent,
    toPercent,
    km: getal(o["km"]),
    kwh: getal(o["kwh"]),
    eur: getal(o["eur"]),
    // `null` blijft `null` (van vóór de standenkeuze, en dat mag niet stil 16 worden); al het andere
    // wordt een stand die de knop heeft, net als in `readSession` — `12.5` uit een bewerkte opslag
    // zou anders als `12.5 A` in de regel komen en in de scripts als een onbekende stand.
    amps: o["amps"] === null || o["amps"] === undefined ? null : clampCurrent(o["amps"]),
  };
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
          amps: entry.amps ?? oud.amps,
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

/** Wat het formulier "beurt achteraf invoeren" aanlevert: `date` is jjjj-mm-dd, `from`/`to` zijn uu:mm. */
export interface ManualInput {
  date: string;
  from: string;
  to: string;
  fromPercent: number;
  toPercent: number;
  km: number | null;
  amps: number;
}

/**
 * Een laadbeurt die je vergeten bent te starten: datum en klok uit het formulier, lokale tijd (zie
 * time.ts). Een `to` vóór of gelijk aan `from` telt als na middernacht — wie om 22:00 insteekt en
 * om 02:00 afkoppelt, typt geen tweede datum.
 *
 * ⚠️ Altijd een eigen regel, nooit een aanvulling van de laatste beurt: de starttijd is de sleutel
 * van `withEntry`, en een aflezing die op de sleutel van een oude beurt terechtkwam was precies
 * hoe de beurt van 27 sep door die van 2 okt werd overschreven. Geeft een foutmelding of de regel.
 */
export function manualEntry(input: ManualInput): Entry | string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  const van = /^(\d{2}):(\d{2})$/.exec(input.from);
  const tot = /^(\d{2}):(\d{2})$/.exec(input.to);
  if (d === null) return "Vul de datum in.";
  if (van === null || tot === null) return "Vul beide tijden in.";
  const at = (t: RegExpExecArray, extraDays = 0) =>
    new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + extraDays, Number(t[1]), Number(t[2])).getTime();
  const startMs = at(van);
  let endMs = at(tot);
  if (endMs <= startMs) endMs = at(tot, 1);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Die datum of tijd bestaat niet.";
  // `new Date(2026, 1, 30)` rolt stil door naar maart: terugrekenen vangt een onmogelijke datum.
  const check = new Date(startMs);
  if (check.getFullYear() !== Number(d[1]) || check.getMonth() !== Number(d[2]) - 1 || check.getDate() !== Number(d[3]))
    return "Die datum bestaat niet.";
  const geldig = (p: number) => Number.isFinite(p) && p >= 0 && p <= 100;
  if (!geldig(input.fromPercent)) return "Vul Start% in (0–100).";
  if (!geldig(input.toPercent)) return "Vul Afgelezen (het eind%) hierboven in (0–100).";
  if (input.toPercent <= input.fromPercent) return "Afgelezen moet hoger zijn dan Start%.";
  // Een beurt in de toekomst of van meer dan een halve dag is bijna zeker een tikfout (Tot gelijk aan
  // Van telt als 24 uur), en `calibrate` leest zo'n regel als meting.
  if (startMs > Date.now()) return "Die beurt begint in de toekomst — controleer de datum.";
  if (endMs - startMs > 12 * 3_600_000) return "Meer dan 12 uur laden — controleer Van en Tot.";
  return {
    startMs,
    endMs,
    fromPercent: Math.round(input.fromPercent),
    toPercent: Math.round(input.toPercent),
    km: input.km === null ? null : Math.round(input.km),
    kwh: null,
    eur: null,
    amps: clampCurrent(input.amps),
  };
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
        // De stand als opmerking, zodat `calibrate` een beurt op 8 A niet naast een op 16 A middelt.
        note: e.amps === null ? undefined : noteForAmps(e.amps),
      } satisfies LogEntry),
    )
    .join("\n");
}
