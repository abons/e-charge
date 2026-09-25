import { covered, mergeQuarters, parseEnergyZero, parseQuarters, type Quarter } from "./core/price.js";

/**
 * De kwartierprijzen van het net halen en op deze telefoon bewaren. Dit is de enige plek in de app
 * die een netwerk aanraakt (sinds 2026-09-25, zie `design.md`), en hij is er niet van afhankelijk:
 * wat eenmaal opgehaald is blijft in `localStorage` staan, en zonder bereik rekent het scherm
 * gewoon door met wat het heeft — of zegt het dat er geen prijzen zijn.
 *
 * Eén bron: de publieke prijzen-API van EnergyZero, zonder sleutel, met de EPEX day-ahead per
 * kwartier — dezelfde markt waar Zonneplan zijn kwartierprijs van maakt. Vanaf een GitHub-runner
 * nagemeten (2026-09-25): de GET én de preflight geven `access-control-allow-origin` voor
 * `abons.github.io`, dus de browser mag erbij. De alternatieven vielen af: het oude
 * `api.energyzero.nl/v1/energyprices` kent geen kwartieren (lege lijst), hun GraphQL alleen uren,
 * en Energy-Charts (Fraunhofer) staat alleen zijn eigen origin toe — precies waarom de eerste
 * versie op de telefoon "geen prijzen" zei.
 *
 * ⚠️ Ophalen is zuinig: alleen als de laadbeurt buiten de bekende prijzen valt, en dan hooguit één
 * keer per kwartier. De prijzen van morgen verschijnen rond 13:00–15:00; een laadbeurt die vanavond
 * over middernacht loopt, krijgt ze dus vanzelf zodra ze er zijn.
 */

const KEY = "e-charge.prices";
const RETRY_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const SOURCE = "EnergyZero";
/** Meer dagen dan dit vraagt geen laadbeurt aan een stopcontact; het houdt een lus ook klein. */
const MAX_REQUESTS = 4;

interface Stored {
  source: string;
  quarters: Quarter[];
}

let stored: Stored = read();
let lastAttemptMs = 0;
let inflight = false;
let failed = false;

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { source: "", quarters: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { source: "", quarters: [] };
    const { source, quarters } = parsed as Record<string, unknown>;
    return { source: typeof source === "string" ? source : "", quarters: parseQuarters(quarters) };
  } catch {
    return { source: "", quarters: [] };
  }
}

function write(value: Stored): void {
  stored = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* zonder opslag blijven de prijzen deze sessie staan; de volgende start haalt ze opnieuw */
  }
}

/** Alle bekende kwartieren, oudste eerst. */
export function known(): Quarter[] {
  return stored.quarters;
}

/** Waar de prijzen vandaan kwamen — voor de regel onderaan het scherm. Leeg zolang er niets is. */
export function sourceName(): string {
  return stored.source;
}

/** Wat het scherm kan melden als er voor een laadbeurt (nog) geen prijs is. */
export function status(): "ophalen" | "mislukt" | "stil" {
  if (inflight) return "ophalen";
  return failed ? "mislukt" : "stil";
}

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** `dd-mm-jjjj` in lokale tijd — zo wil de API de dag, en de dag is hier een lokale dag. */
function apiDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function url(dayMs: number): string {
  return (
    "https://public.api.energyzero.nl/public/v1/prices" +
    `?energyType=ENERGY_TYPE_ELECTRICITY&date=${apiDate(dayMs)}&interval=INTERVAL_QUARTER`
  );
}

/**
 * Zorg dat [fromMs, toMs) prijzen heeft; haalt ze zo nodig op en roept [onUpdate] zodra er iets
 * veranderd is. Synchroon klaar als alles al bekend is of er net nog geprobeerd is.
 */
export function ensure(fromMs: number, toMs: number, onUpdate: () => void): void {
  if (covered(fromMs, toMs, stored.quarters)) return;
  const now = Date.now();
  if (inflight || now - lastAttemptMs < RETRY_MS) return;
  lastAttemptMs = now;
  inflight = true;
  // De API geeft per gevraagde dag ook de dag ervoor en (zodra gepubliceerd) de dag erna. Dus
  // vragen we de dag ná de eerste dag die we nodig hebben, en daarna steeds drie dagen verder —
  // in de praktijk is dat één aanroep: de laadbeurt van vannacht begint gisteren en eindigt morgen.
  const firstDay = startOfLocalDay(Math.min(fromMs, now));
  const lastDay = startOfLocalDay(Math.max(toMs, now));
  const days: number[] = [];
  for (let d = firstDay + DAY_MS; d - DAY_MS <= lastDay && days.length < MAX_REQUESTS; d += 3 * DAY_MS) days.push(d);
  void fetchQuarters(days)
    .then((quarters) => {
      inflight = false;
      failed = quarters.length === 0;
      if (!failed) {
        // Ouder dan drie dagen is voor deze app verleden tijd — behalve als de laadbeurt zelf zo
        // oud is: wat net voor haar is opgehaald, mag niet meteen weer weg, anders is ze nooit
        // gedekt en gaat elk kwartier hetzelfde venster opnieuw naar de bron.
        const keepFromMs = Math.min(firstDay, startOfLocalDay(now) - 3 * DAY_MS);
        write({ source: SOURCE, quarters: mergeQuarters(stored.quarters, quarters, keepFromMs) });
      }
      onUpdate();
    })
    .catch((e: unknown) => {
      // `fetchQuarters` verwerpt zelf nooit; dit vangt een `onUpdate` (→ `render`) die gooit.
      inflight = false;
      console.error("prijzen: bijwerken mislukt", e);
    });
}

async function fetchQuarters(days: number[]): Promise<Quarter[]> {
  let all: Quarter[] = [];
  for (const day of days) {
    try {
      const resp = await fetch(url(day), { mode: "cors", cache: "no-store" });
      if (!resp.ok) continue;
      all = mergeQuarters(all, parseEnergyZero(await resp.json()), 0);
    } catch {
      /* geen net — dan blijft wat er is, en over een kwartier nog eens */
    }
  }
  return all;
}
