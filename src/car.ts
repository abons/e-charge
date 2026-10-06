import { isPlate, parseRdw, type Rdw } from "./core/car.js";

/**
 * Een kenteken opzoeken bij RDW — de tweede plek in de app die een netwerk aanraakt (naast
 * `prices.ts`), en net als die niet verplicht: zonder bereik of zonder treffer kan een auto met een
 * eigen naam worden opgeslagen.
 *
 * Open data (`opendata.rdw.nl`, dataset `m9d7-ebf2`, zonder sleutel). Gemeten op 2026-10-06:
 * `access-control-allow-origin: *` op de GET. Er gaan geen eigen headers mee, dus geen preflight.
 * Alleen op een expliciete "Zoek", nooit op de achtergrond. `sw.js` laat andere origins door, dus dit
 * wordt niet gecachet en werkt niet offline.
 *
 * ⚠️ Het kenteken gaat in de URL naar RDW (hun logs); het blijft verder op de telefoon.
 */
const URL_BASE = "https://opendata.rdw.nl/resource/m9d7-ebf2.json";
const TIMEOUT_MS = 8000;

export type Lookup = { kind: "gevonden"; rdw: Rdw } | { kind: "niet gevonden" } | { kind: "mislukt" };

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** [plate] is al genormaliseerd; een ongeldige invoer komt hier nooit in de URL. */
export async function lookupPlate(plate: string, fetchFn: FetchFn = fetch): Promise<Lookup> {
  if (!isPlate(plate)) return { kind: "niet gevonden" };
  try {
    const response = await fetchFn(`${URL_BASE}?kenteken=${plate}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return { kind: "mislukt" };
    const rdw = parseRdw(await response.json());
    return rdw === null ? { kind: "niet gevonden" } : { kind: "gevonden", rdw };
  } catch {
    return { kind: "mislukt" };
  }
}
