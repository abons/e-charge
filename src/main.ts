import {
  CHARGE_CURRENTS_A,
  RATED_CURRENT_A,
  clampCurrent,
  clampPercent,
  estimate,
  percentAfter,
  powerKwAt,
  rangeKm,
} from "./core/charge.js";
import { lookupPlate } from "./car.js";
import {
  CARS_KEY,
  CAR_KEY,
  FIRST_CAR_ID,
  MIGRATED_KEY,
  activeCar,
  adoptLegacy,
  carFromPlate,
  carKey,
  carTitle,
  isPlate,
  normalizePlate,
  parseCars,
  withCar,
  withoutCar,
  type Car,
  type Rdw,
} from "./core/car.js";
import { LEAF_START, kmPerPp, measureRate, ratePerHour, setupAt, type Source, type Start } from "./core/derive.js";
import { brands, estimateFromKwh, estimateStart, evById, evLabel, matchEv, modelsOf, variantsOf, type Ev } from "./core/evest.js";
import { cheapestStart, readyBy, type Advice } from "./core/advice.js";
import { CHART_W, priceChart, type Band } from "./core/chart.js";
import { calendar } from "./core/ics.js";
import {
  manualEntry,
  parseEntries,
  toMarkdown,
  withEntry,
  withMeterAsPercent,
  withoutEntry,
  type Entry,
} from "./core/logbook.js";
import { ENERGY_TAX_EUR_PER_KWH, SUPPLIER_MARKUP_EUR_PER_KWH, VAT, chargingCost, eurPerKm, type Cost } from "./core/price.js";
import { parseGetal } from "./core/parse.js";
import { clock, dayLabel, duration, number as nl } from "./core/time.js";
import * as prices from "./prices.js";
import { dailyDue, mergeBackups, parseBackups, restorable, restoreMissing, shrinks, withBackup, type Backup } from "./core/backup.js";
import { parseGone, stampChanges, type Shared } from "./core/sync.js";
import { delenAan, requestSync, startSync, syncStatus } from "./sync.js";

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
 * doelpercentage (een voorkeur), de laadstand van de kabel (ook een voorkeur: de knop op het blok
 * staat waar hij staat) en de lopende laadsessie (zodat die een herstart van de telefoon overleeft
 * — anders is hij nutteloos).
 *
 * De laadstand is de enige knop van de lader die de app kent: 8 tot 16 A, en het vermogen schaalt
 * mee (`setupAt` in `charge.ts`). Alles wat rekent krijgt `setup()` mee, zodat het scherm, de
 * kosten, de agenda-tekst en de logregel op dezelfde stand staan.
 */

const TARGET_KEY = "e-charge.target";
const AMPS_KEY = "e-charge.amps";
const READY_BY_KEY = "e-charge.readyby";
const DEFAULT_TARGET = 90;
/** De sleutels van sessie, laatst afgesloten beurt en logboek horen bij de actieve auto (`carKey`). */
const sessionKey = (): string => carKey("session", car.id);
const finishedKey = (): string => carKey("finished", car.id);
const logbookKey = (): string => carKey("logbook", car.id);
const COPY_LABEL = "📋 Kopieer logregel";
const COPY_ALL_LABEL = "📋 Kopieer hele logboek";
const SAVE_LABEL = "💾 Bewaar laadbeurt";
const MANUAL_SAVE_LABEL = "💾 Bewaar als nieuwe beurt";
/** Vier seconden "💾 Bewaard" op de knop; `renderSaveTarget` zet het label anders meteen terug. */
let bewaardFlits = false;
/**
 * `true` zolang het veld Huidig de schatting bevat die ⏹ erin zette, en `false` zodra jij erin typt:
 * dan is het een aflezing. Alleen dit onderscheidt een geschatte van een gemeten `eind%` in de logregel.
 */
let huidigIsSchatting = false;
/** Zo vaak herrekenen: in de plan-stand loopt "nu" door, in de bezig-stand het percentage. */
const TICK_MS = 15_000;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const currentInput = el<HTMLInputElement>("current");
const targetInput = el<HTMLInputElement>("target");
const ampsSelect = el<HTMLSelectElement>("amps");
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
const costKmOut = el("costkm");
const adviceLine = el("adviceline");
const adviceOut = el("advice");
const adviceNote = el("advicenote");
const priceDialog = el<HTMLDialogElement>("pricedlg");
const adviceText = el("advicetext");
const readoutOut = el("readout");
const chartBox = el("chart");
const legendOut = el("legend");
const readyBySelect = el<HTMLSelectElement>("readyby");
const tariffOut = el("tariff");
const noteOut = el("note");
const setupOut = el("setup");
const kmInput = el<HTMLInputElement>("km");
const pctInput = el<HTMLInputElement>("logpct");
const saveButton = el<HTMLButtonElement>("savelog");
const copyButton = el<HTMLButtonElement>("copylog");
const copyAllButton = el<HTMLButtonElement>("copyall");
const logNote = el("lognote");
const saveTarget = el("savetarget");
const manualDate = el<HTMLInputElement>("m-date");
const manualFrom = el<HTMLInputElement>("m-from");
const manualTo = el<HTMLInputElement>("m-to");
const manualPctFrom = el<HTMLInputElement>("m-pct-from");
const manualBlock = el<HTMLDetailsElement>("manual");
const logBook = el<HTMLDetailsElement>("logbook");
const logCount = el("logcount");
const logLineOut = el("logline");
const logList = el("loglist");
const logActions = el("logactions");
const logHint = el("loghint");
const backupLine = el("backupline");
const chargeButton = el<HTMLButtonElement>("start-charging");
const calendarButton = el<HTMLButtonElement>("calendar");
const installButton = el<HTMLButtonElement>("install");
const carButton = el<HTMLButtonElement>("carbtn");
const carDialog = el<HTMLDialogElement>("cardlg");
const carList = el<HTMLUListElement>("carlist");
const plateInput = el<HTMLInputElement>("plate");
const carNameInput = el<HTMLInputElement>("carname");
const carRateInput = el<HTMLInputElement>("car-rate");
const carKmInput = el<HTMLInputElement>("car-km");
const carNote = el("carnote");
const syncNote = el("syncnote");
const evBrandSelect = el<HTMLSelectElement>("evbrand");
const evModelSelect = el<HTMLSelectElement>("evmodel");
const evVariantSelect = el<HTMLSelectElement>("evvariant");
const carModeSelect = el<HTMLSelectElement>("carmode");
const carModeRow = el("carmoderow");
const carKwhInput = el<HTMLInputElement>("car-kwh");
const carSaveButton = el<HTMLButtonElement>("carsave");
const carCloseButton = el<HTMLButtonElement>("carclose");

/**
 * De auto's op deze telefoon en de actieve. Logboek, sessie en laatst afgesloten beurt zijn per
 * auto (`carKey`); doel en laadstand zijn van de kabel en de eigenaar, niet van de auto. De Leaf van
 * vóór de autokeuze houdt de oude sleutels, dus er wordt bij het overstappen niets gekopieerd.
 */
let cars: Car[] = [];
let car: Car = { id: FIRST_CAR_ID, label: "", plate: null, rdw: null, start: null, ev: null };

/**
 * Een lopende laadsessie: het moment en het percentage waarop de berekening staat, en het doel.
 *
 * `logStartMs`/`logFrom` zijn iets anders dan `startMs`/`from`: die eerste twee zijn het moment dat
 * je de stekker erin stak, en die overleven het opnieuw verankeren. Zonder dat onderscheid zou een
 * tussentijdse aflezing de logregel korter maken dan de laadbeurt werkelijk duurde.
 */
interface Session {
  startMs: number;
  from: number;
  logStartMs: number;
  logFrom: number;
  amps: number;
  /**
   * `true` als `from` van het dashboard is afgelezen; `false` als het een schatting is (een standwissel
   * verankert op het gerekende percentage, en Huidig kan nog de schatting van een vorige ⏹ zijn).
   * Alleen een aflezing als begin geeft een meting (`learnRate`).
   */
  real?: boolean;
}
let session: Session | null = null;

/** De laatst afgesloten sessie, zodat je de logregel ná het afkoppelen nog kunt kopiëren. */
interface Finished { startMs: number; endMs: number; from: number; amps: number }
let finished: Finished | null = null;

/** Het logboek op deze telefoon — een kladblok; `log.md` in de repo is de duurzame kopie. */
let logbook: Entry[] = [];

/** Wat de laatste render uitrekende — wat de agendaknop in het `.ics` zet. */
let ready: {
  startMs: number;
  readyMs: number;
  from: number;
  to: number;
  amps: number;
  label: string;
  cost: Cost | null;
} | null = null;

/**
 * Wat het startadvies en de prijsgrafiek nodig hebben uit de laatste render: hoe lang de beurt duurt
 * en met welk vermogen, en — tijdens het laden — het venster van de lopende beurt. `null` zolang er
 * niets te laden valt.
 */
let plan: { durationMs: number; powerKw: number; lopend: { startMs: number; endMs: number } | null } | null = null;

/** De laadstand die op het scherm gekozen is; de `<select>` kent alleen standen uit `charge.ts`. */
function currentAmps(): number {
  return clampCurrent(Number(ampsSelect.value));
}

/**
 * De stand waar nu mee gerekend wordt. Tijdens het laden is dat de stand van de sessie — de
 * keuzelijst staat daar dan ook op; een andere keuze verankert de sessie opnieuw (zie de
 * change-listener), zodat de twee nooit uiteenlopen.
 */
function activeAmps(): number {
  return session ? session.amps : currentAmps();
}

/** De auto aan de kabel op die stand — wat alles wat rekent meekrijgt. */
function setup() {
  return setupAt(activeAmps(), logbook, car.start);
}

/** Een leeg veld is geen 0: dan is er nog niets ingevuld en valt er niets te rekenen. */
function percentOf(input: HTMLInputElement): number | null {
  const value = parseGetal(input.value);
  return value === null ? null : clampPercent(value);
}

/** Nieuwe prijzen binnen: tariefregel en scherm opnieuw. */
function opnieuw(): void {
  renderTariff();
  render();
}

/** Het scherm, en de prijsgrafiek als die openstaat — die tikt mee met de klok. */
function render(): void {
  renderMain();
  if (priceDialog.open) renderPriceDialog();
}

function renderMain(): void {
  renderSaveTarget();
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
  plan = null;
  showAdvice(null, now);

  if (from === null) {
    rangeLabel.textContent = `Bereik bij ${to}%`;
    rangeOut.textContent = "–";
    show("–", "–", null, "");
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
  const opzet = setup();
  rangeOut.textContent = rangeText(rangePercent, opzet);
  // Een auto zonder startwaarden en met te weinig eigen beurten heeft geen snelheid: dan geen
  // antwoord verzinnen (en `estimate` zou "laden niet nodig" zeggen). Starten en bewaren kan wel,
  // want juist die beurten maken de snelheid bekend.
  if (!(opzet.ratePpPerHour > 0)) {
    show("–", "–", null, "");
    showCost(null);
    note("Laadsnelheid van deze auto nog onbekend: bewaar een paar beurten, of vul startwaarden in.", "info");
    calendarButton.disabled = true;
    chargeButton.disabled = false;
    return;
  }
  const result = estimate(from, to, opzet);
  // Zonder laadtijd valt er ook geen percentage te schatten: `percentAfter` geeft dan het startpunt
  // terug. Liever de regel weg dan een bevroren getal laten staan.
  nowLine.hidden = session === null || !result.needed;

  if (!result.needed) {
    show("—", "—", null, "");
    showCost(null);
    note(`Laden niet nodig: je zit met ${from}% al op of boven je doel van ${to}%.`, "ok");
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
  const cost = chargingCost(shownStartMs, readyMs, opzet.powerKw, prices.known());
  // Eerst `ensure`, dán tonen: anders leest `showCost` de status van vóór het ophalen en staat er
  // op de eerste render een kaal streepje zonder "prijzen ophalen…".
  prices.ensure(shownStartMs, readyMs, opnieuw);
  // Daarna pas het startadvies (vandaag, en na 13:00 morgen): de beurt zelf gaat voor, want beide
  // delen één poging per kwartier. Tijdens het laden valt er niets te adviseren.
  if (!session) prices.ensureAhead(now, opnieuw);
  showCost(cost, true);
  plan = {
    durationMs: readyMs - shownStartMs,
    powerKw: opzet.powerKw,
    lopend: session ? { startMs: shownStartMs, endMs: readyMs } : null,
  };
  showAdvice(
    session ? null : cheapestStart(now, result.minutes * 60_000, opzet.powerKw, prices.known(), readyBy(now, readyByHour())),
    now,
  );

  if (session) {
    const soc = Math.floor(percentAfter(session.from, to, now - session.startMs, opzet));
    nowPctOut.textContent = `${soc}%`;
    nowKmOut.textContent = rangeText(soc, opzet);
    show(duration(Math.max(0, remainingMs) / 60_000), clock(readyMs), label, sourceTag());
    // Voorbij het doel blijft de schatting oplopen naar 100% — de auto kent jouw doel niet. Dus
    // noemt deze regel `soc` en niet `to`: die laatste bevroor op 90% terwijl er 98% in zat.
    note(
      remainingMs <= 0
        ? `Volgens de schatting op ${soc}%. Klopt dat niet? Vul het echte % in.`
        : null,
    );
  } else {
    show(duration(result.minutes), clock(readyMs), label, sourceTag());
    note(null);
  }

  // De agenda-afspraak beschrijft de hele laadbeurt, dus vanaf het insteken en het percentage van
  // toen — niet vanaf de laatste tussentijdse aflezing.
  ready = {
    startMs: shownStartMs,
    readyMs,
    from: session ? session.logFrom : from,
    to,
    amps: activeAmps(),
    label: label ?? "",
    cost,
  };
  calendarButton.disabled = false;
  chargeButton.disabled = false;
}

/** `± 86 km`, of een streepje zolang de kilometers per procentpunt van deze auto onbekend zijn. */
function rangeText(percent: number, opzet: ReturnType<typeof setup>): string {
  return opzet.kmPerPp > 0 ? `± ${rangeKm(percent, opzet)} km` : "–";
}

/** Zonder laadbeurt om over te rapporteren — of zonder eindpercentage — valt er niets te loggen. */
function updateCopyButton(): void {
  // In het klapblok "achteraf invoeren" valideert de knop zelf, met een melding in woorden.
  const niets = !manualBlock.open && huidigeLaadbeurt() === null;
  copyButton.disabled = niets;
  saveButton.disabled = niets;
}

/**
 * Waar de getallen vandaan komen, als tag achter de bijregel: niets als alles uit je eigen logboek
 * komt, "startwaarde" zolang er te weinig beurten zijn, en "geschat uit 16 A" voor een stand waar je
 * nog niet op geladen hebt. Zo is een vreemde uitkomst altijd te herleiden.
 */
function sourceTag(): string {
  const amps = activeAmps();
  const rate = ratePerHour(logbook, amps, car.start);
  // Een lagere stand schaalt uit 16 A, en die snelheid kan zelf nog een startwaarde zijn.
  const bovenste = rate.source === "schaling" ? ratePerHour(logbook, RATED_CURRENT_A, car.start) : rate;
  const tags: string[] = [];
  if (rate.source === "schaling") tags.push(`geschat uit ${RATED_CURRENT_A} A`);
  if (bovenste.source === "start" || kmPerPp(logbook, car.start).source === "start") tags.push(car.start?.measured === true && ratePerHour(logbook, amps, car.start).source !== "onbekend" && kmPerPp(logbook, car.start).source !== "start" ? "gemeten" : car.start?.estimated === true ? "schatting" : "startwaarde");
  if (kmPerPp(logbook, car.start).source === "onbekend") tags.push("km per % onbekend");
  return tags.length === 0 ? "" : ` · ${tags.join(", ")}`;
}

function show(durationText: string, readyText: string, day: string | null, powerText: string): void {
  durationOut.textContent = durationText;
  readyOut.textContent = readyText;
  readyDayOut.textContent = day ?? "";
  powerOut.textContent = powerText;
}

/**
 * De kostenregel. `null` is "niets te rekenen" én "geen prijzen"; alleen in dat tweede geval
 * ([expected]) zegt het woordje erachter waarom: tijdens het ophalen, of als de bron weigerde.
 * Een schatting over kwartieren die nog niet geprijsd zijn (morgen, vóór 13:00) heet ook zo — de
 * rekening is dan nog niet bekend.
 */
function showCost(cost: Cost | null, expected = false): void {
  if (cost === null) {
    costOut.textContent = "–";
    costKmOut.textContent = "–";
    const status = expected ? prices.status() : "stil";
    costNote.textContent = status === "ophalen" ? "prijzen ophalen…" : status === "mislukt" ? "geen prijzen" : "";
    return;
  }
  costOut.textContent = `€ ${nl(cost.eur, 2)}`;
  costNote.textContent = `${Math.round(cost.avgEurPerKwh * 100)} ct/kWh${cost.complete ? "" : ", deels geschat"}`;
  // Per kilometer bij de gemiddelde prijs van deze beurt en het verbruik uit `charge.ts` — dezelfde
  // aanname als "Bereik", dus de twee regels kunnen elkaar niet tegenspreken.
  const perKm = eurPerKm(cost.avgEurPerKwh, setup());
  costKmOut.textContent = perKm === null ? "–" : `${nl(perKm * 100)} ct/km`;
}

/**
 * De regel "Goedkoopste start": het tijdstip en wat het scheelt met nu. Tijdens het laden valt er
 * niets meer te kiezen; de grafiek erachter laat dan de lopende beurt zien.
 */
function showAdvice(advice: Advice | null, now: number): void {
  if (advice === null) {
    adviceOut.textContent = "–";
    adviceNote.textContent =
      plan === null ? "" : plan.lopend !== null ? "laden loopt" : prices.status() === "ophalen" ? "prijzen ophalen…" : "te weinig prijzen";
    return;
  }
  if (advice.startMs === now) {
    adviceOut.textContent = "nu";
    adviceNote.textContent = advice.tooLate ? `haalt ${clock(readyBy(now, readyByHour()))} niet` : "al goedkoopst";
    return;
  }
  adviceOut.textContent = clock(advice.startMs);
  const dag = dayLabel(now, advice.startMs);
  adviceNote.textContent = `${dag === null ? "" : `${dag} · `}−€ ${nl(advice.savingEur, 2)}`;
}

/**
 * De modal achter "Goedkoopste start": het advies in woorden en de kwartierprijzen als grafiek, met
 * de beurt van nu en die van het advies als banden. Rekent opnieuw met de klok van nu, zodat hij
 * klopt met wat er net op het scherm stond.
 */
let grafiek: ReturnType<typeof priceChart> = null;
function renderPriceDialog(): void {
  const now = Date.now();
  // Wie de grafiek open heeft wil prijzen zien, ook zonder percentage of tijdens het laden — en ook
  // als 13:00 verstrijkt terwijl hij openstaat: daarom hier, bij elke tik, en niet alleen bij openen.
  prices.ensureAhead(now, opnieuw);
  const known = prices.known();
  const p = plan;
  const uur = readyByHour();
  const deadline = readyBy(now, uur);
  const advice = p === null || p.lopend !== null ? null : cheapestStart(now, p.durationMs, p.powerKw, known, deadline);
  const bands: Band[] = [];
  let legend = "";
  const laden = (ms: number) => duration(ms / 60_000);
  if (p === null) {
    adviceText.textContent = "Vul je huidige percentage in, dan zoekt de app het goedkoopste moment om te beginnen.";
  } else if (p.lopend !== null) {
    bands.push({ ...p.lopend, kind: "nu" });
    legend = `<span class="sw nu"></span>deze laadbeurt`;
    adviceText.textContent =
      `Je laadt sinds ${clock(p.lopend.startMs)}, klaar rond ${clock(p.lopend.endMs)}` +
      `${ready?.cost ? `: € ${nl(ready.cost.eur, 2)}` : ""}.`;
  } else if (advice === null) {
    bands.push({ startMs: now, endMs: now + p.durationMs, kind: "nu" });
    legend = `<span class="sw nu"></span>nu starten`;
    adviceText.textContent =
      `De bekende prijzen reiken niet ver genoeg voor ${laden(p.durationMs)} laden. ` +
      "De prijzen van morgen verschijnen rond 13:00.";
  } else if (advice.startMs === now) {
    bands.push({ startMs: advice.startMs, endMs: advice.endMs, kind: "advies" });
    legend = `<span class="sw advies"></span>nu starten`;
    adviceText.textContent = advice.tooLate
      ? `Om ${clock(deadline)} klaar lukt niet meer: ${laden(p.durationMs)} laden is pas rond ` +
        `${clock(advice.endMs)} klaar. Nu starten is het vroegst (€ ${nl(advice.eur, 2)}).`
      : `Nu starten is het goedkoopst: € ${nl(advice.eur, 2)} voor ${laden(p.durationMs)} laden, ` +
        `klaar rond ${clock(advice.endMs)}.`;
  } else {
    bands.push({ startMs: now, endMs: now + p.durationMs, kind: "nu" });
    bands.push({ startMs: advice.startMs, endMs: advice.endMs, kind: "advies" });
    legend = `<span class="sw nu"></span>nu starten <span class="sw advies"></span>goedkoopste start`;
    const dag = dayLabel(now, advice.startMs);
    const eindDag = dayLabel(now, advice.endMs);
    adviceText.textContent =
      `Start om ${clock(advice.startMs)}${dag === null ? "" : ` ${dag}`}, klaar rond ${clock(advice.endMs)}` +
      `${eindDag === null || eindDag === dag ? "" : ` ${eindDag}`}: € ${nl(advice.eur, 2)}. ` +
      `Nu starten kost € ${nl(advice.nowEur, 2)}, dus je bespaart € ${nl(advice.savingEur, 2)}.`;
  }
  // Tijdens het laden valt er niets meer te kiezen.
  el("readybyrow").hidden = p?.lopend != null;
  legendOut.innerHTML = legend;
  legendOut.hidden = legend === "";
  // Tot de deadline (zonder keuze een etmaal), maar nooit korter dan de beurt die erin getekend staat.
  const totMs = Math.max(deadline, ...bands.map((b) => b.endMs));
  grafiek = priceChart(known, now, bands, totMs, uur === null || p?.lopend ? null : deadline);
  // Alleen eigen getallen en vaste tekst in de SVG, dus `innerHTML` is hier veilig.
  chartBox.innerHTML = grafiek === null ? "" : grafiek.svg;
  if (grafiek === null) {
    readoutOut.textContent = prices.status() === "ophalen" ? "Prijzen ophalen…" : "Nog geen prijzen.";
    return;
  }
  // De klok tikt elke 15 s een nieuwe grafiek: zet de vinger terug waar hij stond, anders springt
  // de uitlezing terug naar "Nu" terwijl je een kwartier van morgen aan het bekijken bent.
  if (aangewezenMs !== null && toonKwartier(aangewezenMs)) return;
  const q = grafiek.quarterAt(now);
  readoutOut.textContent =
    q === null ? " " : `Nu (${clock(q.startMs)}–${clock(q.endMs)}): ${Math.round(q.eurPerKwh * 100)} ct/kWh`;
}

/** Het moment waar de vinger het laatst op de grafiek stond; `null` tot je hem aanraakt. */
let aangewezenMs: number | null = null;

/** De vinger op de grafiek: kruisdraad, stip en de prijs van dat kwartier in de regel erboven. */
function wijsAan(e: PointerEvent): void {
  const svg = chartBox.querySelector("svg");
  if (grafiek === null || svg === null) return;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0) return;
  const ms = grafiek.msAt(((e.clientX - rect.left) * CHART_W) / rect.width);
  if (toonKwartier(ms)) aangewezenMs = ms;
}

/** Kruisdraad, stip en uitlezing op [ms]; `false` als daar (nu) geen kwartier in de grafiek is. */
function toonKwartier(ms: number): boolean {
  const svg = chartBox.querySelector("svg");
  if (grafiek === null || svg === null) return false;
  const q = grafiek.quarterAt(ms);
  const cross = svg.querySelector("#pc-cross");
  const dot = svg.querySelector("#pc-dot");
  if (q === null || cross === null || dot === null) return false;
  const xx = String(grafiek.x(ms));
  cross.setAttribute("x1", xx);
  cross.setAttribute("x2", xx);
  cross.setAttribute("visibility", "visible");
  dot.setAttribute("cx", xx);
  dot.setAttribute("cy", String(grafiek.y(q.eurPerKwh)));
  dot.setAttribute("visibility", "visible");
  const dag = dayLabel(Date.now(), q.startMs);
  readoutOut.textContent =
    `${dag === null ? "" : `${dag[0]!.toUpperCase()}${dag.slice(1)} `}${clock(q.startMs)}–${clock(q.endMs)}: ` +
    `${Math.round(q.eurPerKwh * 100)} ct/kWh`;
  return true;
}

function openPriceDialog(): void {
  aangewezenMs = null;
  renderPriceDialog();
  priceDialog.showModal();
}

function note(text: string | null, kind: "ok" | "info" = "ok"): void {
  noteOut.hidden = text === null;
  noteOut.textContent = text ?? "";
  noteOut.className = kind === "info" ? "note info" : "note";
}

/** De agenda-afspraak: de eindtijd, met de aanname erbij zodat je later ziet waar die uit kwam. */
function addToCalendar(): void {
  if (!ready) return;
  const opzet = setupAt(ready.amps, logbook, car.start);
  const result = estimate(ready.from, ready.to, opzet);
  const text = calendar({
    readyMs: ready.readyMs,
    title: `${carName()} ${ready.to}% — klaar met laden`,
    description:
      `Gestart om ${clock(ready.startMs)} op ${ready.from}%, doel ${ready.to}%.\n` +
      `${nl(opzet.ratePpPerHour)} procentpunt per uur op ${ready.amps} A (${bronTekst(ratePerHour(logbook, ready.amps, car.start).source)}), ` +
      `${duration(result.minutes)} laden.` +
      (ready.cost === null
        ? ""
        : `\nKosten ≈ € ${nl(ready.cost.eur, 2)} (${Math.round(ready.cost.avgEurPerKwh * 100)} ct/kWh, Zonneplan` +
          `${ready.cost.complete ? "" : ", deels geschat"}).`),
  });
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "klaar.ics";
  link.click();
  // Pas vrijgeven als de browser de download echt heeft opgepakt; direct revoken breekt Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** De naam zonder kenteken: voor de agenda en overal waar tekst de telefoon verlaat. */
function carName(): string {
  const naam = car.rdw === null ? car.label : `${car.rdw.merk} ${car.rdw.model}`.trim();
  return naam === "" ? "Auto" : naam;
}

/** `startwaarde uit log.md` is waar alleen voor de Leaf; een andere auto heeft de startwaarden van de eigenaar. */
function startTekst(deel: "snelheid" | "bereik" = "bereik"): string {
  if (deel === "snelheid" && car.start?.measured === true) return "gemeten in de eerste beurt van deze auto";
  if (car.start?.estimated === true) {
    const ev = evById(car.ev);
    return ev === null ? "schatting uit accugrootte" : `schatting uit accugrootte van de ${ev.brand} ${ev.model} ${evLabel(ev)}, kan ±25% afwijken`;
  }
  return car.start?.ratePpPerHour === LEAF_START.ratePpPerHour ? "startwaarde uit log.md" : "startwaarde van jou";
}

function bronTekst(source: Source): string {
  return source === "eigen" ? "uit je logboek" : source === "schaling" ? "geschat uit 16 A" : source === "onbekend" ? "onbekend" : startTekst("snelheid");
}

// Eén regel onderaan met waar de getallen vandaan komen — er is geen aanname meer, alleen je eigen
// logboek of (zolang dat te weinig beurten heeft) een startwaarde uit `log.md`. Zo is een uitkomst die
// vreemd voelt meteen te herleiden. De snelheid is die van de gekozen stand, dus de regel gaat mee
// zodra de keuzelijst verandert.
function renderSetup(): void {
  const amps = activeAmps();
  const rate = ratePerHour(logbook, amps, car.start);
  const km = kmPerPp(logbook, car.start);
  const snelheid =
    rate.source === "eigen"
      ? `${nl(rate.value)} procentpunt per uur op ${amps} A (mediaan van ${rate.n} laadbeurten uit je logboek)`
      : rate.source === "schaling"
        ? `${nl(rate.value)} procentpunt per uur op ${amps} A (geschat uit ${RATED_CURRENT_A} A: je hebt nog niet vaak genoeg op deze stand geladen)`
        : rate.source === "onbekend"
          ? "onbekend (nog te weinig laadbeurten in het logboek van deze auto, en geen startwaarden ingevuld)"
          : `${nl(rate.value)} procentpunt per uur op ${amps} A (${startTekst("snelheid")}: nog te weinig laadbeurten in je logboek)`;
  const bereik =
    km.source === "eigen"
      ? `${nl(km.value)} km per procentpunt (uit ${km.n} ritten in je logboek)`
      : km.source === "onbekend"
        ? "onbekend"
        : `${nl(km.value)} km per procentpunt (${startTekst()})`;
  setupOut.textContent = `Laadsnelheid: ${snelheid}. Bereik: ${bereik}.`;
}

// En de tariefopbouw, uit dezelfde constanten als de kostensom (`price.ts`): de marktprijs per
// kwartier plus wat Zonneplan en de fiscus erbovenop leggen. De bron komt erbij zodra er prijzen
// zijn — wie een bedrag ziet, hoort te kunnen zien waar het vandaan komt.
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

/** De laadstand is net zo'n voorkeur als het doel: onthouden als het kan, anders de hoogste stand. */
function readAmps(): number {
  try {
    return clampCurrent(Number(localStorage.getItem(AMPS_KEY)));
  } catch {
    return RATED_CURRENT_A;
  }
}

/** "Auto klaar vóór": een heel uur, of `null` voor geen grens. Een voorkeur, net als het doel. */
function readReadyBy(): number | null {
  try {
    const raw = localStorage.getItem(READY_BY_KEY);
    const h = raw === null || raw === "" ? NaN : Number(raw);
    return Number.isInteger(h) && h >= 0 && h < 24 ? h : null;
  } catch {
    return null;
  }
}
function writeReadyBy(value: number | null): void {
  try {
    localStorage.setItem(READY_BY_KEY, value === null ? "" : String(value));
  } catch {
    /* geen opslag; de keuze geldt deze sessie */
  }
}
/** Wat er nu in de keuzelijst staat. */
function readyByHour(): number | null {
  return readyBySelect.value === "" ? null : Number(readyBySelect.value);
}

function writeAmps(value: number): void {
  try {
    localStorage.setItem(AMPS_KEY, String(value));
  } catch {
    /* geen opslag; de keuze geldt deze sessie, de volgende start staat weer op de hoogste stand */
  }
}

/**
 * De lopende sessie overleeft een herstart van de browser — een aftelling die verdwijnt zodra je
 * je telefoon wegbergt, is geen aftelling. Kapotte of ontbrekende opslag kost hier alleen de
 * bezig-stand; de rekenmachine blijft werken, dus alles wat misgaat leidt naar `null`.
 */
function readSession(): Session | null {
  try {
    return parseSession(localStorage.getItem(sessionKey()));
  } catch {
    return null;
  }
}

function parseSession(raw: string | null): Session | null {
  try {
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { startMs, from, logStartMs, logFrom, amps } = parsed as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof from !== "number") return null;
    if (!Number.isFinite(startMs) || startMs <= 0) return null;
    return {
      startMs,
      from: clampPercent(from),
      // Een sessie uit een oudere versie kent deze twee niet; dan is de laadbeurt zelf het beste dat we hebben.
      logStartMs: typeof logStartMs === "number" && logStartMs > 0 ? logStartMs : startMs,
      logFrom: typeof logFrom === "number" ? clampPercent(logFrom) : clampPercent(from),
      // En de stand ook niet: vóór 2026-09-27 rekende alles op de hoogste, dus dat is hij dan.
      amps: clampCurrent(amps),
      // Een sessie uit een oudere versie kent het niet: dan geen meting, liever te voorzichtig.
      real: (parsed as Record<string, unknown>)["real"] === true,
    };
  } catch {
    return null;
  }
}

function writeSession(value: Session | null, lokaal = true): void {
  session = value;
  try {
    if (value === null) localStorage.removeItem(sessionKey());
    else localStorage.setItem(sessionKey(), JSON.stringify(value));
  } catch {
    /* zonder opslag werkt de aftelling wel, maar overleeft hij het sluiten van de app niet */
  }
  if (lokaal) stateChanged();
}

function readLogbook(): Entry[] {
  try {
    return parseEntries(localStorage.getItem(logbookKey()));
  } catch {
    return [];
  }
}

/** Het vangnet (`core/backup.ts`): een paar momentopnamen van het logboek van deze auto, op deze telefoon. */
function readBackups(): Backup[] {
  try {
    return parseBackups(localStorage.getItem(carKey("backup", car.id)));
  } catch {
    return [];
  }
}

function pushBackup(entries: Entry[]): void {
  try {
    localStorage.setItem(carKey("backup", car.id), JSON.stringify(withBackup(readBackups(), entries, Date.now())));
  } catch {
    /* zonder opslag is er ook geen logboek dat het vangnet nodig heeft */
  }
}

/** Geschiedenisregels uit Firestore bij de lokale back-ups, oudste eerst. */
function addBackups(plate: string, extra: Backup[]): void {
  // De auto kan gewisseld zijn terwijl de geschiedenis werd opgehaald: dan hoort ze niet bij deze auto.
  if (extra.length === 0 || car.plate !== plate) return;
  try {
    localStorage.setItem(carKey("backup", car.id), JSON.stringify(mergeBackups(readBackups(), extra)));
  } catch {
    /* zonder opslag blijft het bij wat Firestore zelf bewaart */
  }
  renderBackup();
}

const HISTORY_KEY = "e-charge.historyat";
const historyAt = (): number => {
  try {
    return Number(localStorage.getItem(HISTORY_KEY)) || 0;
  } catch {
    return 0;
  }
};
const markHistory = (ms: number): void => {
  try {
    localStorage.setItem(HISTORY_KEY, String(ms));
  } catch {
    /* dan schrijft de volgende ronde er weer één: te veel is veiliger dan te weinig */
  }
};

function writeLogbook(value: Entry[], lokaal = true): void {
  // Vlak voordat een regel verdwijnt (een ×, een samenvoeging met de partner) een opname van wat er nu staat.
  if (shrinks(logbook, value)) pushBackup(logbook);
  if (lokaal) {
    const gestempeld = stampChanges(logbook, value, syncMeta.gone, Date.now());
    value = gestempeld.logbook;
    syncMeta = { ...syncMeta, gone: gestempeld.gone };
    saveSyncMeta();
  }
  logbook = value;
  try {
    localStorage.setItem(logbookKey(), JSON.stringify(value));
  } catch {
    /* zonder opslag blijft het logboek deze sessie staan; kopiëren werkt gewoon */
  }
  if (lokaal) requestSync();
}

function readFinished(): Finished | null {
  try {
    return parseFinished(localStorage.getItem(finishedKey()));
  } catch {
    return null;
  }
}

function parseFinished(raw: string | null): Finished | null {
  try {
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { startMs, endMs, from, amps } = parsed as Record<string, unknown>;
    if (typeof startMs !== "number" || typeof endMs !== "number" || typeof from !== "number") return null;
    if (!Number.isFinite(startMs) || startMs <= 0 || endMs < startMs) return null;
    return { startMs, endMs, from: clampPercent(from), amps: clampCurrent(amps) };
  } catch {
    return null;
  }
}

function writeFinished(value: Finished): void {
  finished = value;
  try {
    localStorage.setItem(finishedKey(), JSON.stringify(value));
  } catch {
    /* dan is de logregel alleen kopieerbaar zolang deze pagina open blijft */
  }
  stateChanged();
}

/**
 * Delen met een partner (`src/sync.ts`, `core/sync.ts`). Wat per auto gedeeld wordt: logboek, sessie en
 * laatst afgesloten beurt. De bijhouder (`syncMeta`) is per auto en lokaal: de wisbewijzen en het moment
 * waarop sessie/afgesloten voor het laatst lokaal veranderden.
 */
let syncMeta: { gone: Record<string, number>; stateAt: number } = { gone: {}, stateAt: 0 };

function readSyncMeta(): void {
  syncMeta = { gone: {}, stateAt: 0 };
  try {
    const raw = localStorage.getItem(carKey("sync", car.id));
    if (raw === null) return;
    const o = JSON.parse(raw) as Record<string, unknown>;
    syncMeta = { gone: parseGone(o["gone"]), stateAt: typeof o["stateAt"] === "number" ? o["stateAt"] : 0 };
  } catch {
    /* kapotte bijhouder: opnieuw beginnen is veilig, de eerstvolgende ronde voegt samen */
  }
  // Een lopende sessie van vóór het delen heeft nog geen tijdstempel en zou van elk document met een stempel
  // verliezen: dan is "nu" het eerlijkste moment (de lege telefoon van een partner houdt 0 en verliest wel).
  if (syncMeta.stateAt === 0 && (session !== null || finished !== null)) {
    syncMeta = { ...syncMeta, stateAt: Date.now() };
    saveSyncMeta();
  }
}

function saveSyncMeta(): void {
  try {
    localStorage.setItem(carKey("sync", car.id), JSON.stringify(syncMeta));
  } catch {
    /* zonder opslag blijft de bijhouder deze sessie staan */
  }
}

/** Een lokale wijziging aan sessie of afgesloten beurt: nieuwste woord, en de partner moet het horen. */
function stateChanged(): void {
  syncMeta = { ...syncMeta, stateAt: Date.now() };
  saveSyncMeta();
  requestSync();
}

const sessionJson = (): string | null => (session === null ? null : JSON.stringify(session));
const finishedJson = (): string | null => (finished === null ? null : JSON.stringify(finished));

/** De stand die de partner ook ziet; wat de ronde leest en vergelijkt. */
function sharedNow(): Shared {
  return { logbook, gone: syncMeta.gone, state: { at: syncMeta.stateAt, session: sessionJson(), finished: finishedJson() } };
}

/** De samengevoegde stand van een ronde lokaal toepassen — zonder dat dat zelf weer een ronde aanvraagt. */
function applyShared(merged: Shared): void {
  const sessieVerandert = merged.state.session !== sessionJson();
  const afgeslotenVerandert = merged.state.finished !== finishedJson();
  syncMeta = { gone: merged.gone, stateAt: merged.state.at };
  saveSyncMeta();
  if (JSON.stringify(merged.logbook) !== JSON.stringify(logbook)) writeLogbook(merged.logbook, false);
  if (afgeslotenVerandert) {
    finished = parseFinished(merged.state.finished);
    try {
      if (finished === null) localStorage.removeItem(finishedKey());
      else localStorage.setItem(finishedKey(), JSON.stringify(finished));
    } catch {
      /* zie writeFinished */
    }
  }
  if (sessieVerandert) {
    writeSession(parseSession(merged.state.session), false);
    // De partner startte of stopte: het scherm volgt, net als na een herstart met een lopende sessie.
    huidigIsSchatting = false;
    // Niet midden in het typen van een aflezing: dan blijft het veld zoals het is (zie de ⚠️-regel in CLAUDE.md).
    const typt = document.activeElement === currentInput;
    if (session !== null) {
      ampsSelect.value = String(session.amps);
      if (!typt) currentInput.value = String(session.from);
    } else if (!typt) {
      currentInput.value = "";
    }
  }
  renderSetup();
  renderLogbook();
  logBook.open = logBook.open || session !== null || bijwerkbaar() !== null;
  render();
}

function readCars(): Car[] {
  try {
    return parseCars(localStorage.getItem(CARS_KEY));
  } catch {
    return [];
  }
}

function writeCars(value: Car[]): void {
  cars = value;
  try {
    localStorage.setItem(CARS_KEY, JSON.stringify(value));
  } catch {
    /* zonder opslag blijven de auto's deze sessie staan */
  }
}

function writeCarId(id: string): void {
  try {
    localStorage.setItem(CAR_KEY, id);
  } catch {
    /* de volgende start valt terug op de eerste auto */
  }
}

/**
 * De adoptie van vóór de autokeuze, en de actieve auto. ⚠️ Eerst alles lezen, dan schrijven, en de
 * marker als laatste: een `SecurityError` halverwege mag geen half werk achterlaten. De oude sleutels
 * blijven staan (de Leaf houdt ze), dus een oude bundel in een open tab schrijft niet in het niets.
 */
function initCars(): void {
  let migrated = false;
  let activeId: string | null = null;
  let legacy = false;
  try {
    migrated = localStorage.getItem(MIGRATED_KEY) === "1";
    activeId = localStorage.getItem(CAR_KEY);
    legacy = ["logbook", "session", "finished"].some((kind) => localStorage.getItem(carKey(kind as "logbook", FIRST_CAR_ID)) !== null);
  } catch {
    /* geen opslag: geen auto, tot de gebruiker er een kiest */
  }
  const adopted = adoptLegacy(readCars(), migrated, legacy);
  cars = adopted.cars;
  if (adopted.changed) writeCars(cars);
  // Eénmalig: wat hierna in de oude sleutels komt is van de gebruiker zelf, niet meer van vóór de autokeuze.
  if (!migrated) {
    try {
      localStorage.setItem(MIGRATED_KEY, "1");
    } catch {
      /* dan doet de volgende start het opnieuw: idempotent */
    }
  }
  const first = activeCar(cars, activeId);
  if (first !== null) car = first;
}

/** Zonder gekozen auto staat er een uitnodiging; de opslag werkt intussen onder de sleutels van de eerste auto. */
function renderCarButton(): void {
  carButton.textContent = cars.length === 0 ? "Kies je auto" : carTitle(car);
}

/**
 * Naar een andere auto: alles wat per auto is wordt opnieuw gelezen (sessie, laatst afgesloten
 * beurt, logboek) en de invoer volgt de sessie. Niet tijdens het laden — dan raken de aftelling en het
 * logboek ontkoppeld; de melding staat in de dialoog, want die staat dan open.
 */
function switchCar(id: string): boolean {
  if (id === car.id) {
    // Dezelfde auto, maar zijn gegevens kunnen net veranderd zijn (kenteken gekoppeld, startwaarden).
    car = cars.find((c) => c.id === id) ?? car;
    requestSync(0);
    renderSyncNote();
    renderCarButton();
    renderSetup();
    render();
    return true;
  }
  if (session !== null) {
    carNote.textContent = "Er loopt een laadbeurt: sluit die eerst af (⏹ Stop) voor je van auto wisselt.";
    return false;
  }
  const next = cars.find((c) => c.id === id);
  if (next === undefined) return false;
  car = next;
  writeCarId(id);
  session = readSession();
  finished = readFinished();
  logbook = readLogbook();
  readSyncMeta();
  requestSync(0);
  renderSyncNote();
  huidigIsSchatting = false;
  currentInput.value = "";
  renderCarButton();
  renderSetup();
  renderLogbook();
  logBook.open = bijwerkbaar() !== null;
  render();
  return true;
}

let teVerwijderen: string | null = null;

function renderCarList(): void {
  carList.replaceChildren();
  for (const c of cars) {
    const li = document.createElement("li");
    if (c.id === car.id) li.className = "on";
    const kies = document.createElement("button");
    kies.type = "button";
    kies.textContent = carTitle(c);
    kies.addEventListener("click", () => {
      if (switchCar(c.id)) carDialog.close();
      else renderCarList();
    });
    li.append(kies);
    if (cars.length > 1) {
      const weg = document.createElement("button");
      weg.type = "button";
      weg.textContent = teVerwijderen === c.id ? "Zeker? Logboek weg" : "×";
      weg.addEventListener("click", () => deleteCar(c.id));
      li.append(weg);
    }
    carList.append(li);
  }
}

/** Twee tikken: het logboek van die auto gaat mee, en dat komt niet terug. */
function deleteCar(id: string): void {
  if (teVerwijderen !== id) {
    teVerwijderen = id;
    renderCarList();
    return;
  }
  teVerwijderen = null;
  if (id === car.id && session !== null) {
    carNote.textContent = "Er loopt een laadbeurt: sluit die eerst af voor je deze auto verwijdert.";
    renderCarList();
    return;
  }
  try {
    for (const kind of ["logbook", "session", "finished", "sync", "backup"] as const) localStorage.removeItem(carKey(kind, id));
  } catch {
    /* de lijst is wat telt; weesgegevens in opslag doen niets */
  }
  const rest = withoutCar(cars, id);
  writeCars(rest);
  if (id === car.id && rest[0] !== undefined) switchCar(rest[0].id);
  renderCarList();
}

/** Een getal met komma of punt, groter dan nul; leeg of onzin is `null`. */
function positiefGetal(input: HTMLInputElement): number | null {
  const n = parseGetal(input.value);
  return n !== null && n > 0 ? n : null;
}

async function saveCar(): Promise<void> {
  if (carSaveButton.disabled) return;
  const plate = normalizePlate(plateInput.value);
  const naam = carNameInput.value.trim();
  const rate = positiefGetal(carRateInput);
  const km = positiefGetal(carKmInput);
  const kwh = positiefGetal(carKwhInput);
  if ((rate === null) !== (km === null) || (carRateInput.value.trim() !== "" && rate === null) || (carKmInput.value.trim() !== "" && km === null)) {
    carNote.textContent = "Vul beide startwaarden in (positieve getallen), of geen van beide.";
    return;
  }
  if (carKwhInput.value.trim() !== "" && kwh === null) {
    carNote.textContent = "De accu in kWh is een positief getal.";
    return;
  }
  if (plate !== "" && !isPlate(plate)) {
    carNote.textContent = "Een kenteken heeft 6 letters en cijfers.";
    return;
  }
  const handmatig: Start | null = rate !== null && km !== null ? { ratePpPerHour: rate, kmPerPp: km } : null;
  const gekozen = evById(evVariantSelect.value === "" ? null : evVariantSelect.value);
  // Zonder auto's is er niets om naast toe te voegen: dan past dit de naamloze opslag aan.
  const bewerk = cars.length === 0 || carModeSelect.value === "edit";
  if (!bewerk && plate === "" && naam === "" && gekozen === null && kwh === null) {
    carNote.textContent = "Vul een kenteken in, of kies merk en model.";
    return;
  }
  // Wat de startwaarden worden, in volgorde: wat je zelf invulde, de uitvoering die je koos, je accu in kWh,
  // wat de auto al had (een gemeten of eerder gekozen waarde wint van een gok), en pas dan een automatische
  // RDW-match.
  const bepaal = (bestaand: Car | null, auto: Ev | null): { start: Start | null; ev: string | null } => {
    if (handmatig !== null) return { start: handmatig, ev: gekozen?.id ?? bestaand?.ev ?? null };
    if (gekozen !== null) return { start: estimateStart(gekozen), ev: gekozen.id };
    if (kwh !== null) return { start: estimateFromKwh(kwh), ev: null };
    if (bestaand !== null && bestaand.start !== null) return { start: bestaand.start, ev: bestaand.ev };
    return auto === null ? { start: null, ev: bestaand?.ev ?? null } : { start: estimateStart(auto), ev: auto.id };
  };
  const oud = plate === "" ? undefined : cars.find((c) => c.id === plate);
  // Het kenteken kan ook bij een auto staan waarvan het id iets anders is (de eerste auto heet `car`).
  const dubbel = plate === "" ? undefined : cars.find((c) => c.plate === plate || c.id === plate);
  if (dubbel !== undefined && dubbel.id !== (bewerk ? car.id : plate)) {
    carNote.textContent = "Dit kenteken staat al bij een andere auto.";
    return;
  }
  let rdw: Rdw | null = null;
  if (plate !== "") {
    carSaveButton.disabled = true;
    carNote.textContent = "Zoeken bij RDW…";
    const gevonden = await lookupPlate(plate);
    carSaveButton.disabled = false;
    if (gevonden.kind !== "gevonden" && naam === "" && !bewerk) {
      carNote.textContent =
        gevonden.kind === "mislukt"
          ? "Geen verbinding met RDW. Geef de auto een eigen naam om hem toch te bewaren."
          : "RDW kent dit kenteken niet. Geef de auto een eigen naam om hem toch te bewaren.";
      return;
    }
    rdw = gevonden.kind === "gevonden" ? gevonden.rdw : null;
  }
  let nieuw: Car;
  if (bewerk) {
    // Dezelfde auto, dus hetzelfde id en dezelfde opslag: logboek en sessie blijven staan.
    const metRdw = rdw ?? car.rdw;
    nieuw = {
      ...car,
      plate: plate === "" ? car.plate : plate,
      rdw: metRdw,
      label: naam === "" ? car.label : naam,
      ...bepaal(car, matchEv(metRdw)[0] ?? null),
    };
  } else if (plate === "") {
    nieuw = { id: `auto-${Date.now().toString(36)}`, label: naam, plate: null, rdw: null, ...bepaal(null, null) };
  } else {
    nieuw = { ...carFromPlate(plate, rdw ?? oud?.rdw ?? null, naam), ...bepaal(oud ?? null, matchEv(rdw ?? oud?.rdw ?? null)[0] ?? null) };
  }
  writeCars(withCar(cars, nieuw));
  if (switchCar(nieuw.id)) {
    carDialog.close();
  } else {
    // Bewaard, maar niet gekozen omdat er een beurt loopt; de melding van `switchCar` blijft staan.
    renderCarList();
  }
  renderCarButton();
}

/** De keuzelijsten merk, model en uitvoering uit de meegebundelde tabel (`evest.ts`). */
function setOptions(select: HTMLSelectElement, placeholder: string, values: { value: string; text: string }[]): void {
  select.replaceChildren(new Option(placeholder, ""));
  for (const v of values) select.append(new Option(v.text, v.value));
  select.disabled = values.length === 0;
  select.value = "";
}

function fillBrands(): void {
  setOptions(evBrandSelect, "Merk…", brands().map((b) => ({ value: b, text: b })));
  setOptions(evModelSelect, "Model…", []);
  setOptions(evVariantSelect, "Uitvoering…", []);
}

function openCarDialog(): void {
  teVerwijderen = null;
  renderCarList();
  plateInput.value = "";
  carNameInput.value = "";
  carRateInput.value = "";
  carKmInput.value = "";
  carNote.textContent = "";
  renderSyncNote();
  fillBrands();
  // Zonder auto's is er niets om naast toe te voegen; met een auto kies je. Standaard: toevoegen.
  carModeSelect.hidden = carModeRow.hidden = cars.length === 0;
  carModeSelect.value = "new";
  carKwhInput.value = "";
  carDialog.showModal();
}

/**
 * Een auto die nog geen eigen logboek heeft en alleen een schatting (of niets) kent, leert zijn snelheid
 * van de eerste tussentijdse aflezing: twee echte aflezingen van het dashboard, minstens een half uur en
 * twee procentpunt uit elkaar (`measureRate`). Dat vervangt de aanname achter de schatting door een
 * meting; het bereik blijft wat het was (een schatting, of onbekend). ⚠️ Nooit over iets wat de eigenaar
 * zelf invulde of eerder mat: alleen over een schatting of een lege start.
 */
function learnRate(s: Session, reading: number): void {
  if (!s.real) return;
  // Alleen over een schatting of een lege start, en één keer: een tweede aflezing in dezelfde beurt
  // overschrijft de eerste meting niet (en nooit een waarde die de eigenaar invulde of eerder mat).
  if (car.start !== null && (car.start.estimated !== true || car.start.measured === true)) return;
  const rate = measureRate(Date.now() - s.startMs, s.from, reading, s.amps);
  if (rate === null) return;
  const start: Start = { ratePpPerHour: rate, kmPerPp: car.start?.kmPerPp ?? 0, measured: true };
  if (car.start?.estimated === true) start.estimated = true;
  car = { ...car, start };
  writeCars(withCar(cars, car));
  renderSetup();
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
    currentInput.value = String(Math.floor(percentAfter(session.from, doel, nu - session.startMs, setupAt(session.amps, logbook, car.start))));
    // Wat nu in het veld staat is een schatting, geen aflezing. De logregel moet dat weten (`estimated`),
    // anders voedt de app zijn eigen rekenwerk terug in het logboek waar de snelheid uit komt.
    huidigIsSchatting = true;
    // Bij het afkoppelen de hele laadbeurt bewaren — vanaf het insteken, niet vanaf de laatste
    // tussentijdse aflezing — zodat de logregel klopt met wat er werkelijk aan de muur hing.
    writeFinished({ startMs: session.logStartMs, endMs: nu, from: session.logFrom, amps: session.amps });
    writeSession(null);
    // Afkoppelen is het moment van de aflezing: het logboek klapt open (hier, nooit in `render()`).
    logBook.open = true;
    render();
    return;
  }
  const from = percentOf(currentInput);
  if (from === null) return;
  const now = Date.now();
  writeSession({ startMs: now, from, logStartMs: now, logFrom: from, amps: currentAmps(), real: !huidigIsSchatting });
  // Nu er een lopende beurt is, bewaart 💾 die — het invoerblok zou de knop kapen.
  manualBlock.open = false;
  render();
}

/** Een getal uit een optioneel veld; leeg of onzin telt als "niet ingevuld". */
function optioneelGetal(input: HTMLInputElement): number | null {
  return parseGetal(input.value);
}

/**
 * De laadbeurt waar de logregel over gaat. Tijdens het laden is dat de stand van nu, na het
 * afkoppelen die van de afgelopen beurt — en dan is het percentage in het veld precies wat je van
 * het dashboard hebt gelezen.
 *
 * [metKosten] rekent het bedrag uit de kwartierprijzen erbij. Dat doet alleen 💾 en 📋: de knoppen
 * vragen elke tik of er een beurt ís, en daarvoor hoeft niet elke tik over alle kwartieren gelopen.
 */
function huidigeLaadbeurt(metKosten = false): Entry | null {
  const nu = Date.now();
  const doel = percentOf(targetInput) ?? DEFAULT_TARGET;
  // Na een herstart staat het percentageveld leeg. Dan telt wat er al bewaard is over deze beurt —
  // anders valt `eind%` terug op het startpercentage, en overschrijft een tweede druk op 💾 (om de
  // meterstand aan te vullen) een goede 90 met een zinloze 43: een laadbeurt van nul procentpunten,
  // die `calibrate` als 0,00 kW meerekent. Is er niets bekend, dan valt er ook niets te loggen.
  const afgelopen = bijwerkbaar();
  const bewaard = afgelopen === null ? undefined : logbook.find((e) => e.startMs === afgelopen.startMs);
  // Het logboek heeft zijn eigen percentageveld, en dat wint: het is wat je van het dashboard hebt
  // gelezen, en het hoeft het plan-scherm niet te verzetten om in de regel te komen.
  const afgelezen = percentOf(pctInput);
  const huidig = percentOf(currentInput);
  // ⚠️ Een echte aflezing wint altijd van een schatting, en een schatting wordt als `estimated`
  // bewaard: de regel blijft (km en tijden zijn echt) maar telt niet mee voor snelheid en bereik.
  //   1. Afgelezen (het logboekveld);
  //   2. Huidig, als jij dat zelf hebt ingetikt — niet de schatting die ⏹ erin zette;
  //   3. wat al bewaard is, als dat een aflezing was (een tweede druk op 💾 mag die niet vervangen);
  //   4. de schatting: Huidig na ⏹, of de gerekende stand tijdens het laden.
  let eind: number | null;
  let geschat = false;
  if (afgelezen !== null) eind = afgelezen;
  else if (!session && huidig !== null && !huidigIsSchatting) eind = huidig;
  else if (!session && bewaard !== undefined && bewaard.estimated !== true) eind = bewaard.toPercent;
  else {
    eind = !session ? (huidig ?? bewaard?.toPercent ?? null) : null;
    geschat = true;
  }
  const bron = session
    ? {
        startMs: session.logStartMs,
        endMs: nu,
        from: session.logFrom,
        to: afgelezen ?? percentAfter(session.from, doel, nu - session.startMs, setupAt(session.amps, logbook, car.start)),
        amps: session.amps,
      }
    : afgelopen !== null && eind !== null
      ? { startMs: afgelopen.startMs, endMs: afgelopen.endMs, from: afgelopen.from, to: eind, amps: afgelopen.amps }
      : null;
  if (bron === null) return null;

  const km = optioneelGetal(kmInput);
  // De kosten uit de kwartierprijzen, alleen als elk kwartier van de beurt er een heeft — een
  // deels geschat bedrag hoort niet in een logboek dat `calibrate` als meting leest. En tot het
  // moment dat de auto volgens de rekenkern op `eind%` stond, niet tot het afkoppelen: wie om
  // 01:30 vol is en om 07:00 de stekker eruit trekt, heeft die zes uur niet betaald. Zo is het
  // bedrag ook precies Δ% × capaciteit ÷ rendement tegen de kwartierprijzen — waar `calibrate` weer
  // door deelt om de prijs terug te vinden. Tijdens het laden is dit de stand tot nu; de bewaarde
  // waarde na het afkoppelen overschrijft hem (`withEntry`).
  const eur = metKosten ? beurtKosten(bron) : null;
  return {
    startMs: bron.startMs,
    endMs: bron.endMs,
    fromPercent: Math.round(bron.from),
    toPercent: Math.round(bron.to),
    km: km === null ? null : Math.round(km),
    // De kWh-kolom vult de app niet meer; wat er ooit in bewaard is blijft staan (`withEntry`).
    kwh: null,
    eur,
    amps: bron.amps,
    estimated: geschat,
  };
}

/** Het bedrag van een beurt uit de kwartierprijzen die er nu bekend zijn, of `null` als er gaten zitten. */
function beurtKosten(bron: { startMs: number; endMs: number; from: number; to: number; amps: number }): number | null {
  // Op de stand van díe beurt, niet op wat de keuzelijst nu toevallig zegt.
  const opzet = setupAt(bron.amps, logbook, car.start);
  const laadMs = estimate(bron.from, bron.to, opzet).minutes * 60_000;
  const totMs = Math.min(bron.endMs, bron.startMs + laadMs);
  const kosten = chargingCost(bron.startMs, totMs, opzet.powerKw, prices.known());
  return kosten !== null && kosten.complete ? Math.round(kosten.eur * 100) / 100 : null;
}

/**
 * De afgesloten beurt die 💾 mag bijwerken: alleen als hij vandaag is afgekoppeld. Een oudere beurt
 * blijft staan zoals hij is — een aflezing van 3 okt overschreef zo de beurt van 27 sep. Wie een
 * oudere beurt wil aanvullen, wist hem (×) en voert hem opnieuw in.
 */
function bijwerkbaar(): Finished | null {
  if (finished === null) return null;
  // Vandaag afgekoppeld, óf minder dan 12 uur geleden: wie om 23:00 stopt en 's ochtends de aflezing
  // erbij zet, werkt dezelfde beurt bij. Een beurt van dagen terug nooit.
  const recent = Date.now() - finished.endMs < 12 * 3_600_000;
  return recent || new Date(finished.endMs).toDateString() === new Date().toDateString() ? finished : null;
}

/** Datum van vandaag en de klok van nu in het blok "achteraf invoeren", alleen waar het veld leeg is. */
function prefillManual(): void {
  const nu = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  if (manualDate.value === "") manualDate.value = `${nu.getFullYear()}-${p(nu.getMonth() + 1)}-${p(nu.getDate())}`;
  if (manualTo.value === "") manualTo.value = `${p(nu.getHours())}:${p(nu.getMinutes())}`;
}

/**
 * Welke beurt 💾 bijwerkt, in woorden. Na het afkoppelen is dat de afgesloten beurt — en die blijft
 * eeuwig staan, ook als je een volgende vergeet te starten. Dan landt je aflezing ongemerkt op de
 * oude beurt; deze regel maakt dat zichtbaar en wijst naar het formulier eronder.
 */
function renderSaveTarget(): void {
  if (!bewaardFlits) saveButton.textContent = manualBlock.open ? MANUAL_SAVE_LABEL : SAVE_LABEL;
  if (manualBlock.open) {
    saveTarget.textContent = "💾 bewaart de hier ingevoerde beurt als nieuwe regel; de afgesloten beurt blijft ongemoeid.";
  } else if (session !== null) {
    saveTarget.textContent = "💾 bewaart de lopende laadbeurt.";
  } else if (bijwerkbaar() !== null) {
    const afgesloten = bijwerkbaar() as Finished;
    const dag = new Date(afgesloten.startMs).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    saveTarget.textContent =
      `💾 werkt de afgesloten beurt van ${dag} (${clock(afgesloten.startMs)}) bij. ` +
      "Een andere beurt vergeten te starten? Voer die hieronder achteraf in.";
  } else {
    saveTarget.textContent = "Geen beurt om te bewaren — start er een, of voer er een achteraf in.";
  }
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

/**
 * De beurt uit het klapblok "achteraf invoeren", met eind% en km uit de gewone logboekvelden;
 * `null` als het blok dicht is (dan geldt de lopende of afgesloten beurt), een tekst bij een fout.
 */
function handmatigeBeurt(): Entry | string | null {
  if (!manualBlock.open) return null;
  const getal = (input: HTMLInputElement): number => (parseGetal(input.value) ?? NaN);
  const beurt = manualEntry({
    date: manualDate.value,
    from: manualFrom.value,
    to: manualTo.value,
    fromPercent: getal(manualPctFrom),
    toPercent: getal(pctInput),
    km: optioneelGetal(kmInput),
    amps: currentAmps(),
  });
  if (typeof beurt === "string") return beurt;
  return { ...beurt, eur: beurtKosten(manualBron(beurt)) };
}

function manualBron(beurt: Entry): { startMs: number; endMs: number; from: number; to: number; amps: number } {
  return {
    startMs: beurt.startMs,
    endMs: beurt.endMs,
    from: beurt.fromPercent,
    to: beurt.toPercent,
    amps: beurt.amps ?? RATED_CURRENT_A,
  };
}

function toonLogMelding(tekst: string): void {
  logNote.textContent = tekst;
  logNote.hidden = false;
  // Een melding in een dicht blok leest niemand.
  logBook.open = true;
}

function copyLogRow(): void {
  const handmatig = handmatigeBeurt();
  if (typeof handmatig === "string") return toonLogMelding(handmatig);
  const beurt = handmatig ?? huidigeLaadbeurt(true);
  if (beurt !== null) naarKlembord(toMarkdown([beurt]), copyButton, COPY_LABEL);
}

/**
 * De laadbeurt in het logboek op deze telefoon. Twee keer drukken voegt niet twee regels toe — de
 * knop blijft staan en na een herstart is de afgelopen beurt er nog steeds, dus gelijke starttijd
 * overschrijft. Zo kun je ook eerst bewaren en later de meterstand erbij zetten.
 */
function saveEntry(): void {
  const handmatig = handmatigeBeurt();
  if (typeof handmatig === "string") return toonLogMelding(handmatig);
  const beurt = handmatig ?? huidigeLaadbeurt(true);
  if (beurt === null) return;
  // Een handmatige beurt is altijd nieuw: dezelfde starttijd als een bestaande regel zou die stil
  // overschrijven en haar km/amps erven. Dus weigeren, met de uitweg erbij.
  if (handmatig !== null && logbook.some((e) => e.startMs === handmatig.startMs)) {
    return toonLogMelding("Er staat al een beurt met precies deze starttijd — wis die eerst (×) of kies een andere tijd.");
  }
  logNote.hidden = true;
  writeLogbook(withEntry(logbook, beurt));
  if (handmatig !== null) {
    // De velden worden leeg gemaakt en het blok klapt dicht; zeg dus wat er bewaard is.
    const dag = new Date(handmatig.startMs).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    const bron = manualBron(handmatig);
    toonLogMelding(
      `Bewaard: ${dag} ${clock(handmatig.startMs)}–${clock(handmatig.endMs)}, ` +
        `${handmatig.fromPercent} → ${handmatig.toPercent}%` +
        (handmatig.eur === null ? ". Bedrag volgt zodra er prijzen zijn (anders: npm run kosten)." : "."),
    );
    // Een beurt van dagen terug ligt buiten de prijzen die er bekend zijn; haal ze op en vul het bedrag
    // aan — alleen als de regel er dan nog is (je kunt hem intussen gewist hebben), en alleen het bedrag.
    prices.ensure(bron.startMs, bron.endMs, () => {
      const eur = beurtKosten(bron);
      const huidig = logbook.find((e) => e.startMs === bron.startMs);
      if (eur !== null && huidig !== undefined && huidig.eur === null) {
        writeLogbook(withEntry(logbook, { ...huidig, eur }));
        renderLogbook();
      }
    });
    // Klaar: de velden leeg en het blok dicht, zodat de volgende druk weer de gewone beurt bewaart.
    for (const input of [manualDate, manualFrom, manualTo, manualPctFrom, pctInput, kmInput]) input.value = "";
    // Vergeten is sporadisch: het blok staat standaard dicht en klapt na bewaren weer dicht.
    manualBlock.open = false;
  }
  saveButton.textContent = "💾 Bewaard";
  bewaardFlits = true;
  setTimeout(() => {
    bewaardFlits = false;
    renderSaveTarget();
  }, 4000);
  renderLogbook();
  // Een bewaarde beurt verandert de snelheid en het bereik, dus ook de uitkomsten bovenaan.
  render();
}

function removeEntry(startMs: number): void {
  writeLogbook(withoutEntry(logbook, startMs));
  renderLogbook();
  render();
}

/** De lijst met bewaarde laadbeurten, nieuwste bovenaan. */
/** De regel onder het logboek: een opname heeft beurten die hier ontbreken, met een knop om ze terug te zetten. */
function renderBackup(): void {
  const kans = restorable(readBackups(), logbook);
  backupLine.hidden = kans === null;
  backupLine.textContent = "";
  if (kans === null) return;
  const dag = new Date(kans.backup.at).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const tekst = document.createElement("span");
  tekst.textContent = `Back-up van ${dag} heeft ${kans.missing.length} beurt${kans.missing.length === 1 ? "" : "en"} die hier ontbreken. `;
  const knop = document.createElement("button");
  knop.type = "button";
  knop.className = "wis";
  knop.textContent = "Zet terug";
  knop.addEventListener("click", () => {
    writeLogbook(restoreMissing(logbook, kans.missing));
    renderLogbook();
    render();
  });
  backupLine.append(tekst, knop);
}

function renderLogbook(): void {
  renderSaveTarget();
  // De voetregel zegt hoeveel beurten de snelheid en het bereik dragen: dat verandert met elke regel
  // die erbij komt of af gaat, en bij het laden pas zodra het logboek is ingelezen.
  renderSetup();
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
    if (e.eur !== null) delen.push(`€ ${nl(e.eur, 2)}`);
    if (e.amps !== null) delen.push(`${e.amps} A`);
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
  renderBackup();
  logCount.textContent = logbook.length === 0 ? "" : ` (${logbook.length})`;
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

// De keuzelijst met laadstanden komt uit `charge.ts` en niet uit de HTML — de regel dat er nergens
// anders een getal van de lader staat. Eenmalig opbouwen is geen `render()`: daarna schrijft JS er
// alleen nog een waarde in.
for (const amps of CHARGE_CURRENTS_A) {
  const option = document.createElement("option");
  option.value = String(amps);
  option.textContent = `${amps} A · ${nl(powerKwAt(amps))} kW`;
  ampsSelect.append(option);
}
ampsSelect.value = String(readAmps());

// "Auto klaar vóór" in de prijsgrafiek: geen grens (dan binnen een etmaal), of een heel uur.
{
  const geen = document.createElement("option");
  geen.value = "";
  geen.textContent = "maakt niet uit (binnen een etmaal)";
  readyBySelect.append(geen);
  for (let h = 0; h < 24; h++) {
    const option = document.createElement("option");
    option.value = String(h);
    option.textContent = `${String(h).padStart(2, "0")}:00`;
    readyBySelect.append(option);
  }
  const bewaard = readReadyBy();
  readyBySelect.value = bewaard === null ? "" : String(bewaard);
}

// Een sessie die nog loopt hoort het scherm meteen in de bezig-stand te zetten, en het veld op het
// percentage waarmee hij begon — anders staat er een leeg veld boven een lopende aftelling. En de
// keuzelijst op de stand van de sessie: dat is de stand waar de aftelling op gerekend is.
initCars();
renderCarButton();
session = readSession();
finished = readFinished();
readSyncMeta();
if (session !== null) ampsSelect.value = String(session.amps);
renderSetup();

// Eenmalig: een bewaarde "meterstand" die de lader er in die uren niet doorheen kán hebben geduwd,
// was een aflezing van het dashboard — dit veld vroeg tot 2026-09-13 om kWh van de meter, en de app
// toont nergens een kWh. Zulke getallen verhuizen naar `eind%`, en de melding zegt dat ook: cijfers
// in iemands logboek verzetten mag, stilletjes doen niet.
const gelezenLogboek = readLogbook();
const verhuisdLogboek = withMeterAsPercent(gelezenLogboek);
const verhuisd = verhuisdLogboek.filter((e, i) => e.kwh !== gelezenLogboek[i]?.kwh).length;
if (verhuisd > 0) {
  logbook = gelezenLogboek;
  writeLogbook(verhuisdLogboek);
  logNote.textContent =
    `${verhuisd} bewaarde laadbeurt${verhuisd === 1 ? "" : "en"} had een meterstand die geen kWh ` +
    "kan zijn — die is als afgelezen percentage in eind% gezet. Kijk de lijst hieronder even na.";
  logNote.hidden = false;
  logBook.open = true;
} else {
  logbook = gelezenLogboek;
}
// Hooguit één opname per etmaal, bij het openen (`core/backup.ts`).
if (logbook.length > 0 && dailyDue(readBackups(), Date.now())) pushBackup(logbook);
renderLogbook();
// Standaard dicht, behalve waar de aflezing nog moet: tijdens het laden en na het afkoppelen.
if (session !== null || bijwerkbaar() !== null) logBook.open = true;
if (session !== null) currentInput.value = String(session.from);

for (const input of [currentInput, targetInput]) {
  input.addEventListener("input", () => {
    if (input === currentInput) huidigIsSchatting = false;
    render();
  });
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
      learnRate(session, value);
      writeSession({ ...session, startMs: Date.now(), from: value, real: true });
    }
    render();
  });
}

// Getalvelden op de telefoon: een tik selecteert de oude waarde (intikken vervangt), en Enter verlaat
// het veld — dat laat het toetsenbord zakken en vuurt `change`, precies als wegtikken. Alleen
// gedrag van de invoer zelf; `render()` blijft van de waarden af.
for (const input of [currentInput, targetInput, kmInput, pctInput, manualPctFrom]) {
  input.addEventListener("focus", () => setTimeout(() => input.select(), 0));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
}

// Doel is bijna altijd 80, 90 of 100: terwijl het veld focus heeft zweeft er een rij met die drie
// onder (de browser-datalist toonde na het selecteren alleen de huidige waarde). Een tik loopt via
// `change`, dus normaliseren, bewaren en rekenen gaan langs dezelfde weg als typen.
const targetOpts = el<HTMLElement>("targetopts");
for (const waarde of [80, 90, 100]) {
  const knop = document.createElement("button");
  knop.type = "button";
  knop.textContent = `${waarde}%`;
  knop.dataset.waarde = String(waarde);
  // Zonder dit pakt de knop de focus en sluit het veld (en de rij) vóór de tik aankomt.
  knop.addEventListener("mousedown", (e) => e.preventDefault());
  knop.addEventListener("click", () => {
    targetInput.value = String(waarde);
    targetInput.dispatchEvent(new Event("change"));
    targetInput.blur();
  });
  targetOpts.append(knop);
}
function toonDoelKeuze(): void {
  const nu = percentOf(targetInput);
  for (const knop of targetOpts.querySelectorAll("button")) {
    knop.classList.toggle("on", Number(knop.dataset.waarde) === nu);
  }
}
targetInput.addEventListener("focus", () => {
  toonDoelKeuze();
  targetOpts.hidden = false;
});
targetInput.addEventListener("input", () => {
  targetOpts.hidden = true;
});
targetInput.addEventListener("blur", () => {
  targetOpts.hidden = true;
});

// Een andere stand tijdens het laden (de stekker werd warm, de knop ging naar 10 A) is net zo'n
// nieuw vertrekpunt als een aflezing: het geschatte percentage van nú wordt het anker, en vanaf hier
// telt het nieuwe vermogen. `logStartMs`/`logFrom` blijven staan; de logregel krijgt de laatste stand.
ampsSelect.addEventListener("change", () => {
  const amps = currentAmps();
  writeAmps(amps);
  if (session !== null && amps !== session.amps) {
    const nu = Date.now();
    const doel = percentOf(targetInput) ?? DEFAULT_TARGET;
    // Naar beneden, zoals het scherm het toont en zoals `readSession` het na een herlaad leest —
    // en de veilige kant: iets te weinig aannemen maakt de schatting hooguit een paar minuten te lang.
    const soc = Math.floor(percentAfter(session.from, doel, nu - session.startMs, setupAt(session.amps, logbook, car.start)));
    writeSession({ ...session, startMs: nu, from: soc, amps, real: false });
  }
  renderSetup();
  render();
});

chargeButton.addEventListener("click", toggleCharging);
copyButton.addEventListener("click", copyLogRow);
saveButton.addEventListener("click", saveEntry);
copyAllButton.addEventListener("click", copyLogbook);
manualBlock.addEventListener("toggle", () => {
  // Vandaag en de klok van nu: scheelt een paar pickers; een eerdere dag kies je zelf.
  if (manualBlock.open) prefillManual();
  // Een oude foutmelding hoort niet mee te gaan naar een andere stand.
  if (!bewaardFlits) logNote.hidden = true;
  renderSaveTarget();
  updateCopyButton();
});
calendarButton.addEventListener("click", addToCalendar);
carButton.addEventListener("click", openCarDialog);
// De herkomst van de laadsnelheid en het bereik: een modal achter ⓘ, geen voetregel meer. De tekst
// staat er al (`renderSetup` schrijft hem bij elke wijziging van stand of logboek).
const infoDialog = el<HTMLDialogElement>("infodlg");
el("infobtn").addEventListener("click", () => infoDialog.showModal());
el("infoclose").addEventListener("click", () => infoDialog.close());
// Een tik naast het venster (op de achtergrond) sluit hem ook.
infoDialog.addEventListener("click", (e) => {
  if (e.target === infoDialog) infoDialog.close();
});
// Het startadvies: de hele regel opent de prijsgrafiek, ook met het toetsenbord.
adviceLine.addEventListener("click", openPriceDialog);
adviceLine.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openPriceDialog();
  }
});
el("priceclose").addEventListener("click", () => priceDialog.close());
priceDialog.addEventListener("click", (e) => {
  if (e.target === priceDialog) priceDialog.close();
});
readyBySelect.addEventListener("change", () => {
  writeReadyBy(readyByHour());
  // Een kwartier waar de vinger stond is geen advies: bij een andere grens terug naar "Nu".
  aangewezenMs = null;
  render();
});
chartBox.addEventListener("pointerdown", wijsAan);
chartBox.addEventListener("pointermove", wijsAan);
carSaveButton.addEventListener("click", () => void saveCar());
evBrandSelect.addEventListener("change", () => {
  setOptions(evModelSelect, "Model…", modelsOf(evBrandSelect.value).map((m) => ({ value: m, text: m })));
  setOptions(evVariantSelect, "Uitvoering…", []);
});
evModelSelect.addEventListener("change", () => {
  const lijst = variantsOf(evBrandSelect.value, evModelSelect.value);
  setOptions(evVariantSelect, "Uitvoering…", lijst.map((e) => ({ value: e.id, text: evLabel(e) })));
  // Eén uitvoering is geen keuze: meteen kiezen.
  if (lijst.length === 1) evVariantSelect.value = lijst[0]!.id;
});
// Enter op het toetsenbord bewaart ook: op de telefoon is dat de knop die er al onder je duim zit.
for (const input of [plateInput, carNameInput]) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void saveCar();
  });
}
carCloseButton.addEventListener("click", () => carDialog.close());

/** De regel in de autodialoog over het delen: wat er mis is, of wanneer het voor het laatst lukte. */
function renderSyncNote(): void {
  syncNote.textContent = !delenAan()
    ? ""
    : car.plate === null
      ? "Zet een kenteken bij deze auto (Huidige auto aanpassen) om sessie en logboek met je partner te delen."
      : syncStatus() || "Delen met je partner via dit kenteken.";
}
startSync({ plate: () => car.plate, read: sharedNow, apply: applyShared, historyAt, markHistory, addBackups }, renderSyncNote);

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
  el<HTMLDetailsElement>("about").open = true;
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
