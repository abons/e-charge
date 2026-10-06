/**
 * De rekenkern: hoe lang het duurt om van het ene percentage naar het andere te laden, en hoeveel
 * kilometer een percentage is.
 *
 * ⚠️ **Sinds 2026-10-06 rekent de app zonder aannames.** Er zijn geen capaciteit, rendement of
 * verbruik meer: de laadsnelheid (procentpunt per uur) en de kilometers per procentpunt komen uit
 * het logboek (`derive.ts`), en alleen waar dat nog te weinig beurten heeft gelden startwaarden die
 * uit `log.md` zijn afgeleid. Wat hier staat is wat van de kabel zelf is afgelezen.
 */

/**
 * Wat er *uit de muur* komt — een gewoon 230V-stopcontact achter de schuur, gevoed vanuit het
 * groepenkastje daar.
 *
 * 3,5 kW staat op het display van de laadkabel zelf (2026-09-13) — dat is ~15 A × 230 V, en het
 * blok zit tussen het stopcontact en de auto, dus dit is het vermogen *uit de muur*. Het is een
 * aflezing en geen aanname, maar ook geen meting van de laadsessie zelf: de lader toont wat hij
 * *nu* trekt, niet wat er over zeven uur gemiddeld doorheen ging. Het telt alleen mee voor de
 * kosten (kWh uit de muur × kwartierprijs); de laadtijd komt niet meer uit dit getal.
 * (De Leaf kan 6,6 kW AC aan, dus de auto is hier nooit de beperking.)
 */
export const CHARGE_POWER_KW = 3.5;

/**
 * De laadstanden van de kabel, in ampère — de Voldt-lader heeft een knop met 8 A als laagste en
 * 16 A als hoogste stand. [CHARGE_POWER_KW] is afgelezen op de hoogste stand ([RATED_CURRENT_A]);
 * de andere standen schalen daar lineair van af (`powerKwAt`), dus 8 A is de helft: 1,75 kW. Dat is
 * bewust níét 230 V × A: de 3,5 op het display is wat er werkelijk stroomt bij "16 A", en die
 * verhouding (0,22 kW per ampère) geldt ook voor de standen eronder.
 *
 * ⚠️ De tussenstanden (10 en 13 A) zijn de gebruikelijke van dit soort kabels en niet van het blok
 * afgelezen; klopt de knop niet met deze lijst, dan verander je hier één regel. De laatste stand
 * moet [RATED_CURRENT_A] zijn, en de test pint dat vast.
 *
 * ⚠️ De laadsnelheid van een lagere stand schaalt in `derive.ts` met dezelfde verhouding, en dat is
 * een rekenregel en geen meting: zonder eigen beurten op die stand zegt het scherm dat ("geschat uit
 * 16 A"). De overhead van de boordlader maakt 8 A waarschijnlijk trager dan lineair.
 */
export const CHARGE_CURRENTS_A: readonly number[] = [8, 10, 13, 16];
/** De stand waarop [CHARGE_POWER_KW] is afgelezen: de hoogste. */
export const RATED_CURRENT_A = 16;

/**
 * Wat een berekening nodig heeft: de snelheid waarmee het percentage oploopt, het vermogen uit de
 * muur (voor de kosten) en hoeveel kilometer één procentpunt is. Komt uit `setupAt` in `derive.ts`.
 */
export interface Setup {
  /** Procentpunt per uur op de gekozen stand — uit het logboek of een startwaarde. */
  ratePpPerHour: number;
  /** Wat er uit de muur komt op de gekozen stand (kabeldisplay), voor kWh en kosten. */
  powerKw: number;
  /** Kilometers per procentpunt — uit opeenvolgende logboekregels of een startwaarde. */
  kmPerPp: number;
}

/**
 * Een geldige laadstand, of de hoogste als [amps] er geen is — een waarde uit opslag of een oude
 * sessie mag het scherm niet op een stand zetten die de knop niet heeft.
 */
export function clampCurrent(amps: unknown): number {
  return typeof amps === "number" && CHARGE_CURRENTS_A.includes(amps) ? amps : RATED_CURRENT_A;
}

/** Wat er uit de muur komt op stand [amps]: [CHARGE_POWER_KW] naar rato van [RATED_CURRENT_A]. */
export function powerKwAt(amps: number): number {
  return (CHARGE_POWER_KW * clampCurrent(amps)) / RATED_CURRENT_A;
}

export interface Estimate {
  /** `false` zodra het huidige percentage het doel al haalt — dan is `minutes` 0. */
  needed: boolean;
  /** Naar boven afgerond: een halve minuut te weinig laden is een verkeerd antwoord. */
  minutes: number;
}

/** Een percentage zoals het dashboard het kent: heel getal, 0–100. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Hoe lang van [fromPercent] naar [toPercent], aan deze [setup].
 *
 * Geen taper-model, en dat is een keuze: de snelheid is een mediaan uit je eigen beurten, en beurten
 * die op 99–100% eindigen tellen daarin niet mee (de duur is daar afgekapt). Lineair en klaar.
 */
export function estimate(fromPercent: number, toPercent: number, setup: Setup): Estimate {
  const from = clampPercent(fromPercent);
  const to = clampPercent(toPercent);
  if (to <= from || !(setup.ratePpPerHour > 0)) return { needed: false, minutes: 0 };
  return { needed: true, minutes: Math.ceil(((to - from) / setup.ratePpPerHour) * 60) };
}

/**
 * De bovengrens van wat er over een laadbeurt van [ms] op de meter bij kán zijn gekomen: het
 * maximum dat de lader er in die tijd doorheen duwt, met ruimte voor het huis dat op dezelfde meter
 * staat.
 *
 * ⚠️ Dit is een zeef voor de `kWh`-kolom van het logboek, geen rekenstap. De app vraagt sinds
 * 2026-09-13 niet meer om een meterstand — ze toont nergens een kWh, dus het enige getal dat je op
 * dat moment in je hand had was het dashboardpercentage, en dat belandde in die kolom.
 * `withMeterAsPercent()` in `logbook.ts` gebruikt deze grens om wat al bewaard is alsnog als
 * aflezing te lezen.
 */
export function maxMeterKwh(ms: number): number {
  // Ruim bemeten, en dat hoort: een grens die twijfelt mag nooit aan een echte meting komen. Altijd
  // met de hoogste stand: een grens hoort niet te zakken omdat de knop toevallig op 8 A stond.
  return (CHARGE_POWER_KW * Math.max(0, ms) * 1.5) / 3_600_000;
}

/**
 * Hoeveel kilometer er bij [percent] ongeveer in zit. Naar beneden afgerond: een kilometer te veel
 * beloven is de duurdere fout.
 */
export function rangeKm(percent: number, setup: Setup): number {
  // ⚠️ Eerst naar beneden, dán klemmen. `clampPercent` rondt af, en dat maakte van 59,7% stilletjes
  // 60% — het scherm zei dan "59%" met de kilometers van 60 ernaast.
  return Math.floor(clampPercent(Math.floor(percent)) * setup.kmPerPp);
}

/**
 * Het percentage dat er na [elapsedMs] laden ongeveer in zit, gestart op [fromPercent].
 *
 * ⚠️ [toPercent] zegt hier alleen *of* er te laden valt en is **geen plafond**: de auto kent jouw
 * doel niet — dat staat in een browser — en laadt door tot 100%.
 *
 * ⚠️ Dit is gerékend, niet gemeten: het is [estimate] achterstevoren. Wie het echte percentage
 * afleest en invult, zet de schatting weer gelijk — en dat getal komt als aflezing in het logboek.
 */
export function percentAfter(fromPercent: number, toPercent: number, elapsedMs: number, setup: Setup): number {
  const from = clampPercent(fromPercent);
  const to = clampPercent(toPercent);
  if (elapsedMs <= 0 || to <= from) return from;
  return Math.min(100, from + setup.ratePpPerHour * (elapsedMs / 3_600_000));
}
