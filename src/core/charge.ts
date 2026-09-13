/**
 * De rekenkern: hoeveel energie er in moet, hoe hard die er in gaat, en hoe lang dat duurt.
 *
 * ⚠️ **Alles wat aan de auto of de lader hangt staat in deze vier constanten** — dat is met opzet
 * de enige plek om te kalibreren. Wie een andere Leaf of een ander stopcontact heeft, verandert
 * hier één getal en klaar; de UI leest ze en rekent nergens anders met vaste waarden.
 */

/**
 * Nissan Leaf 2019 (ZE1) met het 40 kWh-pakket: bruto 40 kWh, bruikbaar ~39 kWh — het verschil is
 * de buffer die de BMS nooit vrijgeeft. Het percentage op het dashboard loopt over dit bruikbare
 * deel, dus dit is het getal waar procenten mee vermenigvuldigd horen te worden.
 */
export const USABLE_CAPACITY_KWH = 39.0;

/**
 * Wat er *uit de muur* komt — een gewoon 230V-stopcontact achter de schuur, gevoed vanuit het
 * groepenkastje daar.
 *
 * 3,5 kW staat op het display van de laadkabel zelf (2026-09-13) — dat is ~15 A × 230 V, en het
 * blok zit tussen het stopcontact en de auto, dus dit is het vermogen *uit de muur*. Het verving de
 * 3,0 kW die tot dan uit het huisverbruik aan de meter was afgeleid; een aflezing op het blok is
 * directer bewijs dan een verschil in een meterstand. (Een meegeleverde Mode 2-kabel staat vaak een
 * stand lager — 8 of 10 A is 1,8 of 2,3 kW — en de volle 16 A zou 3,7 kW zijn.)
 *
 * ⚠️ Het is nog steeds geen meting van de laadsessie zelf: de lader toont wat hij *nu* trekt, niet
 * wat er over zeven uur gemiddeld doorheen ging. Zodra één laadbeurt van bekend % naar bekend %
 * bekend is, is dat exact uit te rekenen: `(doel% − start%) × 0,39 ÷ uren` geeft het effectieve
 * vermogen, en gedeeld door [EFFICIENCY] het vermogen uit de muur. (De Leaf kan 6,6 kW AC aan, dus
 * de auto is hier nooit de beperking.)
 */
export const CHARGE_POWER_KW = 3.5;

/**
 * Rendement muur → batterij. Aan een stopcontact is dit merkbaar slechter dan aan een laadpunt: de
 * vaste kosten van de boordlader, de BMS en (bij warm of koud weer) de koeling lopen door terwijl
 * er maar een paar kW doorheen gaat, dus die overhead is een groter aandeel. Gemeten waarden voor
 * een Leaf aan een stopcontact liggen grofweg tussen 85% en 90%; 88% is daar een eerlijk midden in.
 *
 * Dit is de helft die *niet* afgelezen is — [CHARGE_POWER_KW] staat op het blok van de kabel, dit
 * getal nergens. Bij twijfel is te laag hier de veiligere fout: dan zegt de app dat het langer
 * duurt, en sta je niet voor een auto die nog niet klaar is.
 *
 * Kalibreren gaat zo: laad één keer van bekend % naar bekend % en kijk hoeveel langer of korter
 * het duurde dan de app zei. 10% te lang → dit getal met ~10% omlaag.
 */
export const EFFICIENCY = 0.88;

/**
 * Verbruik, voor het omrekenen van procenten naar kilometers. Een Leaf 40 kWh doet in gemengd
 * Nederlands rijden grofweg 17 kWh/100 km: in de zomer eerder 15, met vorst en verwarming ruim 20.
 *
 * ⚠️ Aan de hoge kant kiezen is hier de veiligere fout, net als het naar boven afronden van de
 * minuten: te veel bereik beloven laat je met een lege accu langs de weg staan, te weinig kost je
 * niets. Wie het echt wil weten, leest het gemiddelde verbruik van de boordcomputer en zet dat hier.
 */
export const CONSUMPTION_KWH_PER_100KM = 17.0;

/** De auto en de lader in vier getallen; de defaults zijn de constanten hierboven. */
export interface Setup {
  capacityKwh: number;
  powerKw: number;
  efficiency: number;
  consumptionKwhPer100Km: number;
}

export const DEFAULT_SETUP: Setup = {
  capacityKwh: USABLE_CAPACITY_KWH,
  powerKw: CHARGE_POWER_KW,
  efficiency: EFFICIENCY,
  consumptionKwhPer100Km: CONSUMPTION_KWH_PER_100KM,
};

export interface Estimate {
  /** `false` zodra het huidige percentage het doel al haalt — dan zijn de andere velden 0. */
  needed: boolean;
  /** Wat er netto de batterij in moet. */
  energyKwh: number;
  /** Wat er daarvoor uit de muur komt (energyKwh gedeeld door het rendement). */
  wallEnergyKwh: number;
  /** Het vermogen dat effectief in de batterij landt — wat de app als laadvermogen toont. */
  effectivePowerKw: number;
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
 * Geen taper-model, en dat is een keuze: een Leaf knijpt pas af als de cellen het vermogen niet
 * meer kwijtkunnen, en een paar kW is daar zó ver onder dat de boordlader tot vlak onder 100% gewoon
 * doorgaat. Bij snelladen zou dit model onzin zijn; hier is het lineair en klaar.
 */
export function estimate(fromPercent: number, toPercent: number, setup: Setup = DEFAULT_SETUP): Estimate {
  const from = clampPercent(fromPercent);
  const to = clampPercent(toPercent);
  const effectivePowerKw = setup.powerKw * setup.efficiency;

  if (to <= from || effectivePowerKw <= 0) {
    return { needed: false, energyKwh: 0, wallEnergyKwh: 0, effectivePowerKw, minutes: 0 };
  }

  const energyKwh = (setup.capacityKwh * (to - from)) / 100;
  return {
    needed: true,
    energyKwh,
    wallEnergyKwh: energyKwh / setup.efficiency,
    effectivePowerKw,
    minutes: Math.ceil((energyKwh / effectivePowerKw) * 60),
  };
}

/**
 * De bovengrens van wat er over een laadbeurt van [ms] op de meter bij kán zijn gekomen: het
 * maximum dat de lader er in die tijd doorheen duwt, met ruimte voor het huis dat op dezelfde meter
 * staat.
 *
 * ⚠️ Dit is een zeef voor de `kWh`-kolom van het logboek, geen rekenstap. De app vraagt sinds
 * 2026-09-13 niet meer om een meterstand — ze toont nergens een kWh, dus het enige getal dat je op
 * dat moment in je hand had was het dashboardpercentage, en dat belandde in die kolom. Zo'n waarde
 * is erger dan een lege kolom: `scripts/calibrate.mjs` rekent er rendement en vermogen uit terug, en
 * het antwoord ziet er precies zo uit als een meting. `withMeterAsPercent()` in `logbook.ts`
 * gebruikt deze grens om wat al bewaard is alsnog als aflezing te lezen.
 */
export function maxMeterKwh(ms: number, setup: Setup = DEFAULT_SETUP): number {
  // Ruim bemeten, en dat hoort: een grens die twijfelt mag nooit aan een echte meting komen. Zelfs
  // met die marge zou 97 kWh aan dit stopcontact ruim achttien uur aan de muur vragen — en dán is
  // het ook geen vergissing meer, maar een lange laadbeurt.
  return (setup.powerKw * Math.max(0, ms) * 1.5) / 3_600_000;
}

/**
 * Hoeveel kilometer er bij [percent] ongeveer in zit. Naar beneden afgerond, om dezelfde reden dat
 * de minuten naar boven gaan: een kilometer te veel beloven is de duurdere fout.
 */
export function rangeKm(percent: number, setup: Setup = DEFAULT_SETUP): number {
  // ⚠️ Eerst naar beneden, dán klemmen. `clampPercent` rondt af, en dat maakte van 59,7% stilletjes
  // 60% — het scherm zei dan "59%" met de kilometers van 60 ernaast.
  const kwh = (setup.capacityKwh * clampPercent(Math.floor(percent))) / 100;
  return Math.floor((kwh / setup.consumptionKwhPer100Km) * 100);
}

/**
 * Het percentage dat er na [elapsedMs] laden ongeveer in zit, gestart op [fromPercent] met
 * [toPercent] als doel — nooit voorbij dat doel, want daar stopt de auto.
 *
 * ⚠️ Dit is gerékend, niet gemeten: de app weet niets van de auto, dus dit is [estimate] achterstevoren
 * en erft al zijn aannames. Wie het echte percentage afleest en invult, zet de schatting weer gelijk;
 * dat is ook de manier om [USABLE_CAPACITY_KWH] en [EFFICIENCY] te controleren.
 */
export function percentAfter(
  fromPercent: number,
  toPercent: number,
  elapsedMs: number,
  setup: Setup = DEFAULT_SETUP,
): number {
  const from = clampPercent(fromPercent);
  const to = clampPercent(toPercent);
  if (elapsedMs <= 0 || to <= from) return from;

  const addedKwh = setup.powerKw * setup.efficiency * (elapsedMs / 3_600_000);
  const added = (addedKwh / setup.capacityKwh) * 100;
  return Math.min(to, from + added);
}
