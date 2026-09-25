import { DEFAULT_SETUP, clampPercent, estimate, percentAfter, rangeKm } from "./core/charge.js";
import { calendar } from "./core/ics.js";
import {
  parseEntries,
  toMarkdown,
  withEntry,
  withMeterAsPercent,
  withoutEntry,
  type Entry,
} from "./core/logbook.js";
import { ENERGY_TAX_EUR_PER_KWH, SUPPLIER_MARKUP_EUR_PER_KWH, VAT, chargingCost, type Cost } from "./core/price.js";
import { clock, dayLabel, duration, number as nl } from "./core/time.js";
import * as prices from "./prices.js";

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
const FINISHED_KEY = "e-charge.finished";
const DEFAULT_TARGET = 90;
const LOGBOOK_KEY = "e-charge.logbook";
const COPY_LABEL = "📋 Kopieer logregel";
const COPY_ALL_LABEL = "📋 Kopieer hele logboek";
const SAVE_LABEL = "💾 Bewaar laadbeurt";
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
const costOut = el("cost");
const costNote = el("costnote");
const tariffOut = el("tariff");
const noteOut = el("note");
const setupOut = el("setup");
const kmInput = el<HTMLInputElement>("km");
const pctInput = el<HTMLInputElement>("logpct");
const saveButton = el<HTMLButtonElement>("savelog");
const copyButton = el<HTMLButtonElement>("copylog");
const copyAllButton = el<HTMLButtonElement>("copyall");
const logNote = el("lognote");
const logLineOut = el("logline");
const logList = el("loglist");
const logActions = el("logactions");
const logHint = el("loghint");
const chargeButton = el<HTMLButtonElement>("start-charging");
const calendarButton = el<HTMLButtonElement>("calendar");
const installButton = el<HTMLButtonElement>("install");

/**
 * Een lopende laadsessie: het moment en het percentage waarop de berekening staat, en het doel.
 *
 * `logStartMs`/`logFrom` zijn iets anders dan `startMs`/`from`: die eerste twee zijn het moment dat
 * je de stekker erin stak, en die overleven het opnieuw verankeren. Zonder dat onderscheid zou een
 * tussentijdse aflezing de logregel korter maken dan de laadbeurt werkelijk duurde.
 */
interface Session { startMs: number; from: number; logStartMs: number; logFrom: number }
let session: Session | null = null;

/** De laatst afgesloten sessie, zodat je de logregel ná het afkoppelen nog kunt kopiëren. */
interface Finished { startMs: number; endMs: number; from: number }
let finished: Finished | null = null;

/** Het logboek op deze telefoon — een kladblok; `log.md` in de repo is de duurzame kopie. */
let logbook: Entry[] = [];

/** Wat de laatste render uitrekende — wat de agendaknop in het `.ics` zet. */
let ready: { startMs: number; readyMs: number; from: number; to: number; label: string; cost: Cost | null } | null = null;

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
  // Waarmee gerékend wordt is het anker van de sessie; wat er "Gestart om" boven staat is het
  // moment van insteken. Na een tussentijdse aflezing lopen die uiteen, en dan hoort het scherm het
  // insteekmoment te noemen — daar hing de auto aan de muur, niet om 12:35.
  const startMs = session ? session.startMs : now;
  const shownStartMs = session ? session.logStartMs : now;

  startLabel.textContent = session ? "Gestart om" : "Start";
  durationLabel.textContent = session ? "Nog" : "Geschatte laadtijd";
  startOut.textContent = clock(shownStartMs);
  chargeButton.textContent = session ? "⏹ Stop" : "⚡ Start laden";
  updateCopyButton();
  // Verborgen tenzij hieronder blijkt dat er een percentage te tonen is. Elke vroege `return` liet
  // deze regel anders staan met een getal dat niet meer meetikt.
  nowLine.hidden = true;
  ready = null;

  if (from === null) {
    rangeLabel.textContent = `Bereik bij ${to}%`;
    rangeOut.textContent = "–";
    show("–", "–", null, "–");
    showCost(null);
    note("Vul je huidige batterijpercentage in.", "info");
    calendarButton.disabled = true;
    chargeButton.disabled = true;
    return;
  }

  // Het bereik hoort bij het hoogste van de twee — sta je al boven je doel, dan is wat je nú hebt
  // het interessante getal. Het label volgt dat percentage, anders zegt de regel iets anders dan hij
  // toont.
  const rangePercent = Math.max(from, to);
  rangeLabel.textContent = `Bereik bij ${rangePercent}%`;
  rangeOut.textContent = `± ${rangeKm(rangePercent)} km`;

  const result = estimate(from, to);
  // Zonder laadtijd valt er ook geen percentage te schatten: `percentAfter` geeft dan het startpunt
  // terug. Liever de regel weg dan een bevroren getal laten staan.
  nowLine.hidden = session === null || !result.needed;

  if (!result.needed) {
    show("—", "—", null, "—");
    showCost(null);
    note(`Laden is niet nodig — je zit met ${from}% al op of boven je doel van ${to}%.`, "ok");
    calendarButton.disabled = true;
    chargeButton.disabled = session === null;
    return;
  }

  const readyMs = startMs + result.minutes * 60_000;
  const label = dayLabel(now, readyMs);
  const remainingMs = readyMs - now;

  // De kosten gaan over de hele laadbeurt — vanaf het insteken, niet vanaf de laatste aflezing — met
  // het vermogen uit de muur, want dát staat op de rekening. Ontbreken er kwartieren, dan haalt
  // `ensure` ze op en rendert opnieuw zodra ze er zijn; dit scherm wacht daar niet op.
  const cost = chargingCost(shownStartMs, readyMs, DEFAULT_SETUP.powerKw, prices.known());
  showCost(cost, true);
  prices.ensure(shownStartMs, readyMs, () => {
    renderTariff();
    render();
  });

  if (session) {
    const soc = Math.floor(percentAfter(session.from, to, now - session.startMs));
    nowPctOut.textContent = `${soc}%`;
    nowKmOut.textContent = `± ${rangeKm(soc)} km`;
    show(duration(Math.max(0, remainingMs) / 60_000), clock(readyMs), label, `± ${nl(result.effectivePowerKw)} kW`);
    // Voorbij het doel blijft de schatting oplopen naar 100% — de auto kent jouw doel niet. Dus
    // noemt deze regel `soc` en niet `to`: die laatste bevroor op 90% terwijl er 98% in zat.
    note(
      remainingMs <= 0
        ? `Volgens de schatting staat hij op ${soc}%. Klopt dat niet, vul dan het echte percentage in — dan begint de schatting opnieuw.`
        : null,
    );
  } else {
    show(duration(result.minutes), clock(readyMs), label, `± ${nl(result.effectivePowerKw)} kW`);
    note(null);
  }

  // De agenda-afspraak beschrijft de hele laadbeurt, dus vanaf het insteken en het percentage van
  // toen — niet vanaf de laatste tussentijdse aflezing.
  ready = {
    startMs: shownStartMs,
    readyMs,
    from: session ? session.logFrom : from,
    to,
    label: label ?? "",
    cost,
  };
  calendarButton.disabled = false;
  chargeButton.disabled = false;
}

/** Zonder laadbeurt om over te rapporteren — of zonder eindpercentage — valt er niets te loggen. */
function updateCopyButton(): void {
  const niets = huidigeLaadbeurt() === null;
  copyButton.disabled = niets;
  saveButton.disabled = niets;
}

function show(durationText: string, readyText: string, day: string | null, powerText: string): void {
  durationOut.textContent = durationText;
  readyOut.textContent = readyText;
  readyDayOut.textContent = day ?? "";
  powerOut.textContent = powerText;
}

/**
 * De kostenregel. `null` is "niets te rekenen" én "geen prijzen"; alleen in dat tweede geval
 * ([expected]) zegt het woordje erachter waarom: tijdens het ophalen, of als beide bronnen weigerden.
 * Een schatting over kwartieren die nog niet geprijsd zijn (morgen, vóór 13:00) heet ook zo — de
 * rekening is dan nog niet bekend.
 */
function showCost(cost: Cost | null, expected = false): void {
  if (cost === null) {
    costOut.textContent = "–";
    const status = expected ? prices.status() : "stil";
    costNote.textContent = status === "ophalen" ? "prijzen ophalen…" : status === "mislukt" ? "geen prijzen" : "";
    return;
  }
  costOut.textContent = `€ ${nl(cost.eur, 2)}`;
  costNote.textContent = `${Math.round(cost.avgEurPerKwh * 100)} ct/kWh${cost.complete ? "" : ", deels geschat"}`;
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
      `${duration(result.minutes)} laden.` +
      (ready.cost === null ? "" : `\nKosten ≈ € ${nl(ready.cost.eur, 2)} (${Math.round(ready.cost.avgEurPerKwh * 100)} ct/kWh, Zonneplan).`),
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

// En de tariefopbouw, uit dezelfde constanten als de kostensom (`price.ts`): de marktprijs per
// kwartier plus wat Zonneplan en de fiscus erbovenop leggen. De bron komt erbij zodra er een is —
// Energy-Charts (Fraunhofer ISE) vraagt naamsvermelding, en dat is toch al eerlijk.
function renderTariff(): void {
  const bron = prices.sourceName();
  tariffOut.textContent =
    `Kosten: EPEX-kwartierprijs + ${nl(SUPPLIER_MARKUP_EUR_PER_KWH * 100)} ct opslag Zonneplan + ` +
    `${nl(ENERGY_TAX_EUR_PER_KWH * 100)} ct energiebelasting, × ${nl(VAT, 2)} btw` +
    (bron === "" ? "" : ` · prijzen via ${bron}`);
}
renderTariff();

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
    const { startMs, from, logStartMs, logFrom } = parsed as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof from !== "number") return null;
    if (!Number.isFinite(startMs) || startMs <= 0) return null;
    return {
      startMs,
      from: clampPercent(from),
      // Een sessie uit een oudere versie kent deze twee niet; dan is de laadbeurt zelf het beste dat we hebben.
      logStartMs: typeof logStartMs === "number" && logStartMs > 0 ? logStartMs : startMs,
      logFrom: typeof logFrom === "number" ? clampPercent(logFrom) : clampPercent(from),
    };
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

function readLogbook(): Entry[] {
  try {
    return parseEntries(localStorage.getItem(LOGBOOK_KEY));
  } catch {
    return [];
  }
}

function writeLogbook(value: Entry[]): void {
  logbook = value;
  try {
    localStorage.setItem(LOGBOOK_KEY, JSON.stringify(value));
  } catch {
    /* zonder opslag blijft het logboek deze sessie staan; kopiëren werkt gewoon */
  }
}

function readFinished(): Finished | null {
  try {
    const raw = localStorage.getItem(FINISHED_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { startMs, endMs, from } = parsed as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof endMs !== "number" || typeof from !== "number") return null;
    if (!Number.isFinite(startMs) || startMs <= 0 || endMs < startMs) return null;
    return { startMs, endMs, from: clampPercent(from) };
  } catch {
    return null;
  }
}

function writeFinished(value: Finished): void {
  finished = value;
  try {
    localStorage.setItem(FINISHED_KEY, JSON.stringify(value));
  } catch {
    /* dan is de logregel alleen kopieerbaar zolang deze pagina open blijft */
  }
}

/** ⚡ Start laden / ⏹ Stop: het enige wat de app van "plannen" naar "bezig" brengt en terug. */
function toggleCharging(): void {
  if (session !== null) {
    const nu = Date.now();
    // ⚠️ Het geschatte percentage in het veld zetten. Dit is de enige plek buiten `render()` waar
    // dat mag, en het moet: anders blijft er na het afkoppelen een uren oude aflezing staan. Het
    // plan-scherm zou daarmee doorrekenen alsof de auto nog op 43% staat, en de logregel zou
    // `eind%` gelijk aan `start%` melden — een laadbeurt van nul procentpunten, die `calibrate`
    // als 0,00 kW meerekent. Wat je hierna van het dashboard leest, typ je eroverheen.
    const doel = percentOf(targetInput) ?? DEFAULT_TARGET;
    currentInput.value = String(Math.floor(percentAfter(session.from, doel, nu - session.startMs)));
    // Bij het afkoppelen de hele laadbeurt bewaren — vanaf het insteken, niet vanaf de laatste
    // tussentijdse aflezing — zodat de logregel klopt met wat er werkelijk aan de muur hing.
    writeFinished({ startMs: session.logStartMs, endMs: nu, from: session.logFrom });
    writeSession(null);
    render();
    return;
  }
  const from = percentOf(currentInput);
  if (from === null) return;
  const now = Date.now();
  writeSession({ startMs: now, from, logStartMs: now, logFrom: from });
  render();
}

/** Een getal uit een optioneel veld; leeg of onzin telt als "niet ingevuld". */
function optioneelGetal(input: HTMLInputElement): number | null {
  const raw = input.value.trim().replace(",", ".");
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * De laadbeurt waar de logregel over gaat. Tijdens het laden is dat de stand van nu, na het
 * afkoppelen die van de afgelopen beurt — en dan is het percentage in het veld precies wat je van
 * het dashboard hebt gelezen.
 */
function huidigeLaadbeurt(): Entry | null {
  const nu = Date.now();
  const doel = percentOf(targetInput) ?? DEFAULT_TARGET;
  // Na een herstart staat het percentageveld leeg. Dan telt wat er al bewaard is over deze beurt —
  // anders valt `eind%` terug op het startpercentage, en overschrijft een tweede druk op 💾 (om de
  // meterstand aan te vullen) een goede 90 met een zinloze 43: een laadbeurt van nul procentpunten,
  // die `calibrate` als 0,00 kW meerekent. Is er niets bekend, dan valt er ook niets te loggen.
  const afgelopen = finished;
  const bewaard = afgelopen === null ? undefined : logbook.find((e) => e.startMs === afgelopen.startMs);
  // Het logboek heeft zijn eigen percentageveld, en dat wint: het is wat je van het dashboard hebt
  // gelezen, en het hoeft het plan-scherm niet te verzetten om in de regel te komen.
  const afgelezen = percentOf(pctInput);
  const eind = afgelezen ?? percentOf(currentInput) ?? bewaard?.toPercent ?? null;
  const bron = session
    ? {
        startMs: session.logStartMs,
        endMs: nu,
        from: session.logFrom,
        to: afgelezen ?? percentAfter(session.from, doel, nu - session.startMs),
      }
    : afgelopen !== null && eind !== null
      ? { startMs: afgelopen.startMs, endMs: afgelopen.endMs, from: afgelopen.from, to: eind }
      : null;
  if (bron === null) return null;

  const km = optioneelGetal(kmInput);
  return {
    startMs: bron.startMs,
    endMs: bron.endMs,
    fromPercent: Math.round(bron.from),
    toPercent: Math.round(bron.to),
    km: km === null ? null : Math.round(km),
    // De kWh-kolom vult de app niet meer; wat er ooit in bewaard is blijft staan (`withEntry`).
    kwh: null,
  };
}

/** Tekst naar het klembord, met de knop als terugkoppeling — en de regel in beeld als het niet lukt. */
function naarKlembord(tekst: string, knop: HTMLButtonElement, label: string): void {
  logLineOut.textContent = tekst;
  logLineOut.hidden = false;
  // Het klembord kan geweigerd worden (geen beveiligde verbinding, een strenge instelling); dan
  // staat de tekst er in elk geval om met de hand over te nemen.
  void navigator.clipboard?.writeText(tekst).then(
    () => { knop.textContent = "📋 Gekopieerd"; },
    () => { knop.textContent = "📋 Hieronder — kopieer met de hand"; },
  );
  setTimeout(() => { knop.textContent = label; }, 4000);
}

function copyLogRow(): void {
  const beurt = huidigeLaadbeurt();
  if (beurt !== null) naarKlembord(toMarkdown([beurt]), copyButton, COPY_LABEL);
}

/**
 * De laadbeurt in het logboek op deze telefoon. Twee keer drukken voegt niet twee regels toe — de
 * knop blijft staan en na een herstart is de afgelopen beurt er nog steeds, dus gelijke starttijd
 * overschrijft. Zo kun je ook eerst bewaren en later de meterstand erbij zetten.
 */
function saveEntry(): void {
  const beurt = huidigeLaadbeurt();
  if (beurt === null) return;
  writeLogbook(withEntry(logbook, beurt));
  saveButton.textContent = "💾 Bewaard";
  setTimeout(() => { saveButton.textContent = SAVE_LABEL; }, 4000);
  renderLogbook();
}

function removeEntry(startMs: number): void {
  writeLogbook(withoutEntry(logbook, startMs));
  renderLogbook();
}

/** De lijst met bewaarde laadbeurten, nieuwste bovenaan. */
function renderLogbook(): void {
  logList.textContent = "";
  for (const e of [...logbook].reverse()) {
    const li = document.createElement("li");
    const datum = document.createElement("span");
    datum.className = "datum";
    datum.textContent = new Date(e.startMs).toLocaleDateString("nl-NL", { day: "2-digit", month: "short" });
    const pct = document.createElement("span");
    pct.className = "pct";
    pct.textContent = `${e.fromPercent} → ${e.toPercent}%`;
    const rest = document.createElement("span");
    rest.className = "rest";
    const delen = [duration((e.endMs - e.startMs) / 60_000)];
    if (e.km !== null) delen.push(`${e.km} km`);
    if (e.kwh !== null) delen.push(`${nl(e.kwh)} kWh`);
    rest.textContent = delen.join(" · ");
    const wis = document.createElement("button");
    wis.type = "button";
    wis.className = "wis";
    wis.textContent = "×";
    wis.title = "Verwijder deze laadbeurt";
    wis.addEventListener("click", () => removeEntry(e.startMs));
    li.append(datum, pct, rest, wis);
    logList.append(li);
  }
  logActions.hidden = logbook.length === 0;
  logHint.hidden = logbook.length === 0;
  logHint.textContent =
    logbook.length === 0
      ? ""
      : `${logbook.length} laadbeurt${logbook.length === 1 ? "" : "en"} op deze telefoon. ` +
        "Plak ze af en toe in log.md — het wissen van websitegegevens neemt deze lijst mee.";
}

function copyLogbook(): void {
  if (logbook.length > 0) naarKlembord(toMarkdown(logbook), copyAllButton, COPY_ALL_LABEL);
}

// Alleen een bruikbaar percentage mag de `value="90"` uit de HTML overschrijven: het doelveld heeft
// altijd een waarde, en dat mag niet afhangen van wat er ooit in opslag terechtkwam.
const storedTarget = readTarget();
if (storedTarget !== null && storedTarget.trim() !== "") targetInput.value = storedTarget;

// Een sessie die nog loopt hoort het scherm meteen in de bezig-stand te zetten, en het veld op het
// percentage waarmee hij begon — anders staat er een leeg veld boven een lopende aftelling.
session = readSession();
finished = readFinished();

// Eenmalig: een bewaarde "meterstand" die de lader er in die uren niet doorheen kán hebben geduwd,
// was een aflezing van het dashboard — dit veld vroeg tot 2026-09-13 om kWh van de meter, en de app
// toont nergens een kWh. Zulke getallen verhuizen naar `eind%`, en de melding zegt dat ook: cijfers
// in iemands logboek verzetten mag, stilletjes doen niet.
const gelezenLogboek = readLogbook();
const verhuisdLogboek = withMeterAsPercent(gelezenLogboek);
const verhuisd = verhuisdLogboek.filter((e, i) => e.kwh !== gelezenLogboek[i]?.kwh).length;
if (verhuisd > 0) {
  writeLogbook(verhuisdLogboek);
  logNote.textContent =
    `${verhuisd} bewaarde laadbeurt${verhuisd === 1 ? "" : "en"} had een meterstand die geen kWh ` +
    "kan zijn — die is als afgelezen percentage in eind% gezet. Kijk de lijst hieronder even na.";
  logNote.hidden = false;
} else {
  logbook = gelezenLogboek;
}
renderLogbook();
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
    } else if (session !== null && value !== null) {
      // Tijdens het laden is een nieuw percentage een *aflezing van de auto*, en die weet het beter
      // dan onze schatting. De sessie begint daarom opnieuw vanaf nu: de aftelling klopt weer, en
      // het verschil met wat er stond is precies de fout in `USABLE_CAPACITY_KWH` × `EFFICIENCY`.
      // `logStartMs`/`logFrom` blijven staan — de laadbeurt begon bij het insteken, niet nu.
      writeSession({ ...session, startMs: Date.now(), from: value });
    }
    render();
  });
}

chargeButton.addEventListener("click", toggleCharging);
copyButton.addEventListener("click", copyLogRow);
saveButton.addEventListener("click", saveEntry);
copyAllButton.addEventListener("click", copyLogbook);
calendarButton.addEventListener("click", addToCalendar);

render();
setInterval(render, TICK_MS);
// Een telefoon die uit de broekzak komt, heeft de timer intussen niet laten lopen: 10:35 kan
// zomaar 14:02 geworden zijn, en dan is elke uitkomst op dit scherm verkeerd.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});
// En na `pageshow`, wat iets anders dekt dan `visibilitychange`: bij terugkeer uit de bfcache is
// het document nooit opnieuw uitgevoerd en stond de timer stil, dus de klok op het scherm loopt
// achter zonder dat er iets "zichtbaar werd".
window.addEventListener("pageshow", render);

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
