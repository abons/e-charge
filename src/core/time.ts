/**
 * Klok- en duurweergave. Alles hier is *lokale* tijd, anders dan bij de zusters: dit is geen
 * contract tussen apparaten maar een stekker in één huis, dus de tijd op de keukenklok is de
 * juiste tijd. Geen Intl-datumformatters voor de klok — `HH:MM` is overal hetzelfde.
 */

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `HH:MM` in lokale tijd. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `8u 35m`, of alleen `35m` als het onder het uur blijft. */
export function duration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}u ${pad2(m)}m` : `${m}m`;
}

/** Hoeveel kalenderdagen [ms] verder ligt dan [fromMs] — 23:50 → 00:10 is 1, niet 0. */
export function dayOffset(fromMs: number, ms: number): number {
  const a = new Date(fromMs);
  const b = new Date(ms);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
}

const WEEKDAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

/**
 * Het woordje achter de eindtijd als die over middernacht gaat: `morgen`, `overmorgen`, anders de
 * weekdag. `null` op dezelfde dag — dan hoort er niets te staan.
 *
 * Verder dan `morgen` komt deze app in de praktijk niet (0 → 100% is ~13 uur aan 3,5 kW), maar de
 * grens ligt niet in dit bestand, dus hij rekent gewoon door.
 */
export function dayLabel(fromMs: number, ms: number): string | null {
  const offset = dayOffset(fromMs, ms);
  if (offset <= 0) return null;
  if (offset === 1) return "morgen";
  if (offset === 2) return "overmorgen";
  return WEEKDAYS[new Date(ms).getDay()] ?? null;
}

/** Een getal met een Nederlandse komma: `2,0` — de app is Nederlands, dus ook de decimalen. */
export function number(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace(".", ",");
}
