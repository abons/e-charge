/**
 * Eén regel voor een getal uit een invoerveld, overal gelijk: komma of punt, spaties eraf, leeg of
 * onzin is `null` (nooit 0 — een leeg veld is niets ingevuld). Geen `1e3`, `0x10` of `Infinity`.
 */
const GETAL = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

export function parseGetal(raw: string): number | null {
  const tekst = raw.trim();
  if (!GETAL.test(tekst)) return null;
  const waarde = Number(tekst.replace(",", "."));
  return Number.isFinite(waarde) ? waarde : null;
}
