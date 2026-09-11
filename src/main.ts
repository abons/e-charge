import { DEFAULT_SETUP, clampPercent, estimate, percentAfter, rangeKm } from "./core/charge.js";
import { calendar } from "./core/ics.js";
import { clock, dayLabel, duration, number as nl } from "./core/time.js";

/**
 * Het enige scherm. Plain DOM, geen framework: de opmaak staat in `web/index.html` en dit bestand
 * schrijft alleen tekst in de plekken die veranderen. Dat is met opzet — een render die de invoer
 * opnieuw opbouwt, gooit je cursor uit het veld dat je net aan het typen bent.
 *
 * Het scherm heeft twee standen, en het verschil zit in één vraag: staat de stekker er al in?
 *
 * - **Plannen** (nog niet gestart): "Start" is de klok van nu, en die loopt door. De app
 *   beantwoordt dus steeds opnieuw *"als ik nú insteek, hoe laat ben ik klaar?"*.
 * - **Bezig** (na ⚡ Start laden): het startmoment staat vast, "Klaar rond" beweegt niet meer, en
 *   het percentage loopt gerékend op. Zonder deze stand schuift de eindtijd mee met de klok terwijl
 *   je auto al aan het laden is — dan klopt het antwoord alleen op het moment dat je het aanzet.
 *
 * De invoervelden blijven de waarheid over de percentages; de enige opgeslagen state is het
 * doelpercentage (een voorkeur) en de lopende laadsessie (zodat die een herstart van de telefoon
 * overleeft — anders is hij nutteloos).
 */

const TARGET_KEY = "e-charge.target";
const SESSION_KEY = "e-charge.session";
const DEFAULT_TARGET = 90;
/** Zo vaak herrekenen: in de plan-stand loopt "nu" door, in de bezig-stand het percentage. */
const TICK_MS = 15_000;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const currentInput = el<HTMLInputElement>("current");
const targetInput = el<HTMLInputElement>("target");
const startLabel = el("startlabel");
const startOut = el("start");
const nowLine = el("nowline");
const nowPctOut = el("nowpct");
const nowKmOut = el("nowkm");
const durationLabel = el("durationlabel");
const durationOut = el("duration");
const readyOut = el("ready");
const readyDayOut = el("readyday");
const rangeLabel = el("rangelabel");
const rangeOut = el("range");
const powerOut = el("power");
const noteOut = el("note");
const setupOut = el("setup");
const chargeButton = el<HTMLButtonElement>("start-charging");
const calendarButton = el<HTMLButtonElement>("calendar");
const installButton = el<HTMLButtonElement>("install");

/** Een lopende laadsessie: het moment en het percentage waarop hij begon, en het doel van toen. */
interface Session { startMs: number; from: number; to: number }
let session: Session | null = null;

/** Wat de laatste render uitrekende — wat de agendaknop in het `.ics` zet. */
let ready: { startMs: number; readyMs: number; from: number; to: number; label: string } | null = null;

/** Een leeg veld is geen 0: dan is er nog niets ingevuld en valt er niets te rekenen. */
function percentOf(input: HTMLInputElement): number | null {
  const raw = input.value.trim();
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? clampPercent(value) : null;
}

function render(): void {
  const now = Date.now();
  const to = percentOf(targetInput) ?? DEFAULT_TARGET;
  // In de bezig-stand telt het percentage waarop de sessie begon, niet wat er nu in het veld staat:
  // het veld is dan het aflezen van zojuist, en dat hoort de sessie opnieuw te verankeren (zie de
  // change-listener), niet stilletjes de lopende berekening te verschuiven.
  const from = session ? session.from : percentOf(currentInput);
  const startMs = session ? session.startMs : now;

  startLabel.textContent = session ? "Gestart om" : "Start";
  durationLabel.textContent = session ? "Nog" : "Geschatte laadtijd";
  rangeLabel.textContent = `Bereik bij ${to}%`;
  startOut.textContent = clock(startMs);
  chargeButton.textContent = session ? "⏹ Stop" : "⚡ Start laden";
  ready = null;

  if (from === null) {
    show("–", "–", null, "–", "–");
    note("Vul je huidige batterijpercentage in.", "info");
    calendarButton.disabled = true;
    chargeButton.disabled = true;
    return;
  }

  const result = estimate(from, to);
  rangeOut.textContent = `± ${rangeKm(Math.max(from, to))} km`;

  if (!result.needed) {
    show("—", "—", null, null, "—");
    note(`Laden is niet nodig — je zit met ${from}% al op of boven je doel van ${to}%.`, "ok");
    calendarButton.disabled = true;
    chargeButton.disabled = session === null;
    return;
  }

  const readyMs = startMs + result.minutes * 60_000;
  const label = dayLabel(now, readyMs);
  const remainingMs = readyMs - now;

  if (session) {
    const soc = percentAfter(session.from, to, now - session.startMs);
    nowPctOut.textContent = `${Math.floor(soc)}%`;
    nowKmOut.textContent = `± ${rangeKm(soc)} km`;
    show(duration(Math.max(0, remainingMs) / 60_000), clock(readyMs), label, null, `± ${nl(result.effectivePowerKw)} kW`);
    note(
      remainingMs <= 0
        ? `Volgens de schatting staat hij op ${to}%. Klopt dat niet, vul dan het echte percentage in — dan begint de schatting opnieuw.`
        : null,
    );
  } else {
    show(duration(result.minutes), clock(readyMs), label, null, `± ${nl(result.effectivePowerKw)} kW`);
    note(null);
  }

  nowLine.hidden = session === null;
  ready = { startMs, readyMs, from, to, label: label ?? "" };
  calendarButton.disabled = false;
  chargeButton.disabled = false;
}

/** `null` voor bereik laat die regel staan zoals render hem al zette; de rest wordt altijd gezet. */
function show(
  durationText: string,
  readyText: string,
  day: string | null,
  rangeText: string | null,
  powerText: string,
): void {
  durationOut.textContent = durationText;
  readyOut.textContent = readyText;
  readyDayOut.textContent = day ?? "";
  if (rangeText !== null) rangeOut.textContent = rangeText;
  powerOut.textContent = powerText;
  if (session === null) nowLine.hidden = true;
}

function note(text: string | null, kind: "ok" | "info" = "ok"): void {
  noteOut.hidden = text === null;
  noteOut.textContent = text ?? "";
  noteOut.className = kind === "info" ? "note info" : "note";
}

/** De agenda-afspraak: de eindtijd, met de aanname erbij zodat je later ziet waar die uit kwam. */
function addToCalendar(): void {
  if (!ready) return;
  const result = estimate(ready.from, ready.to);
  const text = calendar({
    readyMs: ready.readyMs,
    title: `Nissan Leaf ${ready.to}% — klaar met laden`,
    description:
      `Gestart om ${clock(ready.startMs)} op ${ready.from}%, doel ${ready.to}%.\n` +
      `${nl(result.energyKwh)} kWh nodig, ± ${nl(result.effectivePowerKw)} kW, ` +
      `${duration(result.minutes)} laden.`,
  });
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "leaf-klaar.ics";
  link.click();
  // Pas vrijgeven als de browser de download echt heeft opgepakt; direct revoken breekt Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Eén regel onderaan met de aannames, gelezen uit dezelfde constanten waarmee gerekend wordt —
// zodat een uitkomst die vreemd voelt, meteen te herleiden is naar wat er in `charge.ts` staat.
setupOut.textContent =
  `${nl(DEFAULT_SETUP.capacityKwh)} kWh bruikbaar · ${nl(DEFAULT_SETUP.powerKw)} kW uit de muur · ` +
  `${Math.round(DEFAULT_SETUP.efficiency * 100)}% rendement · ` +
  `${nl(DEFAULT_SETUP.consumptionKwhPer100Km)} kWh/100 km`;

/**
 * Het doelpercentage is een voorkeur en geen vereiste, dus mag opslag ook ontbreken: met cookies
 * geblokkeerd of in sommige privé-modi gooit `localStorage` een `SecurityError`, en dat mag nooit
 * de rekenmachine meesleuren — dit staat op top-level, nog vóór er één listener hangt.
 */
function readTarget(): string | null {
  try {
    return localStorage.getItem(TARGET_KEY);
  } catch {
    return null;
  }
}

function writeTarget(value: string): void {
  try {
    localStorage.setItem(TARGET_KEY, value);
  } catch {
    /* geen opslag; het veld werkt deze sessie gewoon, alleen de volgende start onthoudt niets */
  }
}

/**
 * De lopende sessie overleeft een herstart van de browser — een aftelling die verdwijnt zodra je
 * je telefoon wegbergt, is geen aftelling. Kapotte of ontbrekende opslag kost hier alleen de
 * bezig-stand; de rekenmachine blijft werken, dus alles wat misgaat leidt naar `null`.
 */
function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { startMs, from, to } = parsed as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof from !== "number" || typeof to !== "number") return null;
    if (!Number.isFinite(startMs) || startMs <= 0) return null;
    return { startMs, from: clampPercent(from), to: clampPercent(to) };
  } catch {
    return null;
  }
}

function writeSession(value: Session | null): void {
  session = value;
  try {
    if (value === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    /* zonder opslag werkt de aftelling wel, maar overleeft hij het sluiten van de app niet */
  }
}

/** ⚡ Start laden / ⏹ Stop: het enige wat de app van "plannen" naar "bezig" brengt en terug. */
function toggleCharging(): void {
  if (session !== null) {
    writeSession(null);
    render();
    return;
  }
  const from = percentOf(currentInput);
  if (from === null) return;
  writeSession({ startMs: Date.now(), from, to: percentOf(targetInput) ?? DEFAULT_TARGET });
  render();
}

// Alleen een bruikbaar percentage mag de `value="90"` uit de HTML overschrijven: het doelveld heeft
// altijd een waarde, en dat mag niet afhangen van wat er ooit in opslag terechtkwam.
const storedTarget = readTarget();
if (storedTarget !== null && storedTarget.trim() !== "") targetInput.value = storedTarget;

// Een sessie die nog loopt hoort het scherm meteen in de bezig-stand te zetten, en het veld op het
// percentage waarmee hij begon — anders staat er een leeg veld boven een lopende aftelling.
session = readSession();
if (session !== null) currentInput.value = String(session.from);

for (const input of [currentInput, targetInput]) {
  input.addEventListener("input", render);
  // Bij het verlaten van het veld pas de waarde aan naar wat er gerekend is (120 wordt 100), zodat
  // het scherm nooit een percentage laat staan waar de uitkomst niet bij hoort.
  input.addEventListener("change", () => {
    const value = percentOf(input);
    if (value !== null) input.value = String(value);
    if (input === targetInput) {
      // Een leeg doelveld zou stil met de default doorrekenen, en dan zegt het scherm iets anders
      // dan de rekenkern. Het doel heeft dus altijd een waarde — anders dan "huidig", dat pas
      // bestaat zodra je het invult.
      if (value === null) targetInput.value = String(DEFAULT_TARGET);
      writeTarget(targetInput.value);
      if (session !== null) writeSession({ ...session, to: percentOf(targetInput) ?? DEFAULT_TARGET });
    } else if (session !== null && value !== null) {
      // Tijdens het laden is een nieuw percentage een *aflezing van de auto*, en die weet het beter
      // dan onze schatting. De sessie begint daarom opnieuw vanaf nu: de aftelling klopt weer, en
      // het verschil met wat er stond is precies de fout in `USABLE_CAPACITY_KWH` × `EFFICIENCY`.
      writeSession({ startMs: Date.now(), from: value, to: session.to });
    }
    render();
  });
}

chargeButton.addEventListener("click", toggleCharging);
calendarButton.addEventListener("click", addToCalendar);

render();
setInterval(render, TICK_MS);
// Een telefoon die uit de broekzak komt, heeft de timer intussen niet laten lopen: 10:35 kan
// zomaar 14:02 geworden zijn, en dan is elke uitkomst op dit scherm verkeerd.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

/** Installeren als app: alleen zichtbaar zodra de browser zelf zegt dat het kan. */
interface InstallPromptEvent extends Event { prompt(): Promise<void> }
let installPrompt: InstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  installButton.hidden = false;
});
installButton.addEventListener("click", () => {
  void installPrompt?.prompt();
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  /**
   * Eén reload zodra een *nieuwe* worker een al bestuurde pagina overneemt — anders blijft een oude
   * bundel hangen.
   *
   * ⚠️ Alleen als er nu al een controller is. Bij het allereerste bezoek is de pagina nog
   * onbestuurd, en dan levert `clients.claim()` in `sw.js` óók een `controllerchange` op: zonder
   * deze vlag herlaadt het eerste bezoek zichzelf en is een percentage dat je in die eerste
   * seconden typte weg.
   */
  const hadController = navigator.serviceWorker.controller !== null;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  void navigator.serviceWorker.register("sw.js");
}
