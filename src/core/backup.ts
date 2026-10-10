import { withEntry, parseEntries, type Entry } from "./logbook.js";

/**
 * Een vangnet voor het logboek: een paar momentopnamen op deze telefoon, zodat een wisbeurt, een foute
 * samenvoeging of een misklik terug te draaien is. Puur; opslag en knop zitten in `main.ts`.
 *
 * ⚠️ Dit is geen archief en geen vervanging van `log.md` of "Kopieer hele logboek": het staat in dezelfde
 * `localStorage` als het logboek zelf en gaat dus mee met het wissen van websitegegevens. Wat het wel
 * vangt is de fout die gemaakt is voor die gebeurt — op 2026-10-10 verdween een logboek bij het eerste
 * delen (zie `design.md`), en er bestond nergens een tweede kopie.
 *
 * Een momentopname komt er in (a) vlak voordat een schrijfactie een regel laat verdwijnen — ook een
 * bewuste × — en (b) hooguit één keer per etmaal bij het openen. Er blijven er acht.
 */
export interface Backup {
  at: number;
  logbook: Entry[];
}

export const MAX_BACKUPS = 8;
export const DAY_MS = 24 * 3_600_000;

export function parseBackups(raw: string | null): Backup[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const uit: Backup[] = [];
  for (const b of value) {
    if (typeof b !== "object" || b === null) continue;
    const o = b as Record<string, unknown>;
    if (typeof o["at"] !== "number" || !Number.isFinite(o["at"])) continue;
    const logbook = parseEntries(JSON.stringify(o["logbook"] ?? []));
    if (logbook.length > 0) uit.push({ at: o["at"], logbook });
  }
  return uit.sort((a, b) => a.at - b.at);
}

/** Verdwijnt er een regel (op starttijd) tussen voor en na? */
export function shrinks(before: Entry[], after: Entry[]): boolean {
  const nu = new Set(after.map((e) => e.startMs));
  return before.some((e) => !nu.has(e.startMs));
}

const inhoud = (l: Entry[]): string => JSON.stringify(l.map((e) => ({ ...e, savedAt: 0 })));

/** De momentopname erbij; niets bij een leeg logboek of als het gelijk is aan de nieuwste. */
export function withBackup(backups: Backup[], logbook: Entry[], now: number): Backup[] {
  if (logbook.length === 0) return backups;
  const nieuwste = backups[backups.length - 1];
  if (nieuwste !== undefined && inhoud(nieuwste.logbook) === inhoud(logbook)) return backups;
  return [...backups, { at: now, logbook }].slice(-MAX_BACKUPS);
}

/** Is er vandaag (de laatste 24 uur) nog geen opname? */
export function dailyDue(backups: Backup[], now: number): boolean {
  const nieuwste = backups[backups.length - 1];
  return nieuwste === undefined || now - nieuwste.at >= DAY_MS;
}

/** De nieuwste opname met regels die nu in het logboek ontbreken, en welke dat zijn. */
export function restorable(backups: Backup[], current: Entry[]): { backup: Backup; missing: Entry[] } | null {
  const nu = new Set(current.map((e) => e.startMs));
  for (let i = backups.length - 1; i >= 0; i--) {
    const backup = backups[i]!;
    const missing = backup.logbook.filter((e) => !nu.has(e.startMs));
    if (missing.length > 0) return { backup, missing };
  }
  return null;
}

/** Het logboek met de ontbrekende regels erbij; wat er al staat blijft zoals het is. */
export function restoreMissing(current: Entry[], missing: Entry[]): Entry[] {
  return missing.reduce((lijst, e) => withEntry(lijst, e), current);
}
