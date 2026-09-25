import {
  covered,
  mergeQuarters,
  parseEnergyCharts,
  parseEnergyZero,
  parseQuarters,
  type Quarter,
} from "./core/price.js";

/**
 * De kwartierprijzen van het net halen en op deze telefoon bewaren. Dit is de enige plek in de app
 * die een netwerk aanraakt (sinds 2026-09-25, zie `design.md`), en hij is er niet van afhankelijk:
 * wat eenmaal opgehaald is blijft in `localStorage` staan, en zonder bereik rekent het scherm
 * gewoon door met wat het heeft — of zegt het dat er geen prijzen zijn.
 *
 * Twee bronnen, allebei zonder sleutel en allebei de EPEX day-ahead voor NL — dezelfde markt waar
 * Zonneplan zijn kwartierprijs van maakt. De eerste die antwoord geeft wint; de tweede is er omdat
 * niet vanaf een bureau te zien is welke van de twee de browser vanaf `abons.github.io` toelaat
 * (CORS), en één mislukte bron mag de kostenregel niet leeg laten.
 *
 * ⚠️ Ophalen is zuinig: alleen als de laadbeurt buiten de bekende prijzen valt, en dan hooguit één
 * keer per kwartier. De prijzen van morgen verschijnen rond 13:00–15:00; een laadbeurt die vanavond
 * over middernacht loopt, krijgt ze dus vanzelf zodra ze er zijn.
 */

const KEY = "e-charge.prices";
const RETRY_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

interface Source {
  name: string;
  url(fromMs: number, toMs: number): string;
  parse(json: unknown): Quarter[];
}

const iso = (ms: number): string => new Date(ms).toISOString();

const SOURCES: Source[] = [
  {
    name: "EnergyZero",
    // `inclBtw=false`: de marktprijs kaal, de opbouw van Zonneplan komt er in `price.ts` overheen.
    url: (a, b) =>
      "https://api.energyzero.nl/v1/energyprices" +
      `?fromDate=${encodeURIComponent(iso(a))}&tillDate=${encodeURIComponent(iso(b - 1))}` +
      "&interval=3&usageType=1&inclBtw=false",
    parse: parseEnergyZero,
  },
  {
    name: "Energy-Charts",
    url: (a, b) =>
      `https://api.energy-charts.info/price?bzn=NL&start=${encodeURIComponent(iso(a))}&end=${encodeURIComponent(iso(b))}`,
    parse: parseEnergyCharts,
  },
];

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
  // Van het begin van de dag waarop de laadbeurt begon tot en met morgen: de sessie kan gisteravond
  // begonnen zijn, en morgen is het verst dat de markt vooruit prijst.
  const windowFrom = startOfLocalDay(Math.min(fromMs, now));
  const windowTo = startOfLocalDay(now) + 2 * DAY_MS;
  void fetchQuarters(windowFrom, windowTo).then((result) => {
    inflight = false;
    failed = result === null;
    if (result === null) {
      onUpdate();
      return;
    }
    // Ouder dan drie dagen is voor deze app verleden tijd; de laadbeurt van gisteravond niet.
    write({
      source: result.source,
      quarters: mergeQuarters(stored.quarters, result.quarters, startOfLocalDay(now) - 3 * DAY_MS),
    });
    onUpdate();
  });
}

async function fetchQuarters(fromMs: number, toMs: number): Promise<{ source: string; quarters: Quarter[] } | null> {
  for (const source of SOURCES) {
    try {
      const resp = await fetch(source.url(fromMs, toMs), { mode: "cors", cache: "no-store" });
      if (!resp.ok) continue;
      const quarters = source.parse(await resp.json());
      if (quarters.length > 0) return { source: source.name, quarters };
    } catch {
      /* geen net, of de bron laat de browser niet toe (CORS) — dan de volgende */
    }
  }
  return null;
}
