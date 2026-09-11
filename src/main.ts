import { DEFAULT_SETUP, clampPercent, estimate } from "./core/charge.js";
import { calendar } from "./core/ics.js";
import { clock, dayLabel, duration, number as nl } from "./core/time.js";

/**
 * Het enige scherm. Plain DOM, geen framework: de opmaak staat in `web/index.html` en dit bestand
 * schrijft alleen tekst in de plekken die veranderen. Dat is met opzet — een render die de invoer
 * opnieuw opbouwt, gooit je cursor uit het veld dat je net aan het typen bent.
 *
 * De invoervelden zijn de enige waarheid; verder is er geen state dan het doelpercentage, dat de
 * volgende keer nog moet kloppen (het is een voorkeur, geen meting — het huidige percentage staat
 * er bewust leeg, want dat is elke keer anders).
 */

const TARGET_KEY = "e-charge.target";
const DEFAULT_TARGET = 90;
/** Zo vaak herrekenen: de starttijd is "nu", en die loopt door terwijl het scherm open staat. */
const TICK_MS = 15_000;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const currentInput = el<HTMLInputElement>("current");
const targetInput = el<HTMLInputElement>("target");
const startOut = el("start");
const durationOut = el("duration");
const readyOut = el("ready");
const readyDayOut = el("readyday");
const powerOut = el("power");
const noteOut = el("note");
const setupOut = el("setup");
const calendarButton = el<HTMLButtonElement>("calendar");
const installButton = el<HTMLButtonElement>("install");

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
  const startMs = Date.now();
  const from = percentOf(currentInput);
  const to = percentOf(targetInput) ?? DEFAULT_TARGET;

  startOut.textContent = clock(startMs);
  ready = null;

  if (from === null) {
    show("–", "–", null, "–");
    note("Vul je huidige batterijpercentage in.", "info");
    calendarButton.disabled = true;
    return;
  }

  const result = estimate(from, to);
  if (!result.needed) {
    show("—", "—", null, "—");
    note(`Laden is niet nodig — je zit met ${from}% al op of boven je doel van ${to}%.`, "ok");
    calendarButton.disabled = true;
    return;
  }

  const readyMs = startMs + result.minutes * 60_000;
  const label = dayLabel(startMs, readyMs);
  show(duration(result.minutes), clock(readyMs), label, `± ${nl(result.effectivePowerKw)} kW`);
  note(null);
  ready = { startMs, readyMs, from, to, label: label ?? "" };
  calendarButton.disabled = false;
}

function show(durationText: string, readyText: string, day: string | null, powerText: string): void {
  durationOut.textContent = durationText;
  readyOut.textContent = readyText;
  readyDayOut.textContent = day ?? "";
  powerOut.textContent = powerText;
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
  `${Math.round(DEFAULT_SETUP.efficiency * 100)}% rendement`;

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

// Alleen een bruikbaar percentage mag de `value="90"` uit de HTML overschrijven: het doelveld heeft
// altijd een waarde, en dat mag niet afhangen van wat er ooit in opslag terechtkwam.
const storedTarget = readTarget();
if (storedTarget !== null && storedTarget.trim() !== "") targetInput.value = storedTarget;

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
    }
    render();
  });
}

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
