/**
 * De rekenkern: hoeveel energie er in moet, hoe hard die er in gaat, en hoe lang dat duurt.
 *
 * ⚠️ **Alles wat aan de auto of de lader hangt staat in deze vier constanten** — dat is met opzet
 * de enige plek om te kalibreren. Wie een andere Leaf of een ander stopcontact heeft, verandert
 * hier één getal en klaar; de UI leest ze en rekent nergens anders met vaste waarden.
 */

/**
 * Wat er tussen 0% en 100% op het dashboard past. Nissan Leaf 2019 (ZE1) met het 40 kWh-pakket:
 * bruto 40, en nieuw was daarvan ~39 bruikbaar — het verschil is de buffer die de BMS nooit
 * vrijgeeft. Die 39 zijn er niet meer: dit is een auto van 2019 met bijna 97.000 km en zonder
 * accukoeling.
 *
 * ⚠️ 30,5 is teruggerekend uit drie laadbeurten in `log.md` (13/17/20 sep 2026: 102 procentpunt in
 * 10u06, dus 10,1 %/uur) bij de 3,5 kW die op [CHARGE_POWER_KW] staat en het rendement hieronder.
 * Dat is SoH ≈ 78%, negen à tien van de twaalf streepjes. Tot 2026-09-20 stond hier 39,0 en was de
 * app daardoor ruim 30% te pessimistisch.
 *
 * ⚠️ Wat de metingen vastpinnen is de *verhouding* `powerKw × efficiency ÷ capacityKwh` — meer
 * bepaalt de laadtijd niet. Dit getal is dus zo goed als [EFFICIENCY] geschat is: 0,93 rendement zou
 * 32,2 kWh betekenen. Voor de laadtijd maakt die verdeling niets uit, voor [rangeKm] wel — en een te
 * lage capaciteit belooft te weinig km, wat de veilige kant is.
 */
export const USABLE_CAPACITY_KWH = 30.5;

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
 * wat er over zeven uur gemiddeld doorheen ging. Drie beurten van bekend % naar bekend % (2026-09-20,
 * zie `log.md`) geven 10,1 %/uur, maar daar staat `powerKw × efficiency ÷ capacityKwh` in en dus
 * niet dit getal apart — de capaciteit is eromheen gefit, niet andersom. Dat dit hier het
 * *afgelezen* getal is en [USABLE_CAPACITY_KWH] het gefitte, is precies de reden dat die aflezing
 * telt. (De Leaf kan 6,6 kW AC aan, dus de auto is hier nooit de beperking.)
 */
export const CHARGE_POWER_KW = 3.5;

/**
 * Rendement muur → batterij. Aan een stopcontact is dit merkbaar slechter dan aan een laadpunt: de
 * vaste kosten van de boordlader, de BMS en (bij warm of koud weer) de koeling lopen door terwijl
 * er maar een paar kW doorheen gaat, dus die overhead is een groter aandeel. Gemeten waarden voor
 * een Leaf aan een stopcontact liggen grofweg tussen 85% en 90%; 88% is daar een eerlijk midden in.
 *
 * Dit is de helft die *niet* afgelezen is — [CHARGE_POWER_KW] staat op het blok van de kabel, dit
 * getal nergens.
 *
 * ⚠️ Sinds de laadtijd gemeten is (2026-09-20) draai je hier niet meer vrij aan: de beurten in
 * `log.md` liggen vast, dus dit getal ruilt één op één tegen [USABLE_CAPACITY_KWH] en verandert aan
 * de laadtijd niets. Wat het wél verschuift is het bereik in km. Alleen de `kWh`-kolom in `log.md` —
 * wat de huismeter over één beurt telde — haalt de twee uit elkaar.
 */
export const EFFICIENCY = 0.88;

/**
 * Verbruik, voor het omrekenen van procenten naar kilometers. Een Leaf 40 kWh doet in gemengd
 * Nederlands rijden grofweg 17 kWh/100 km: in de zomer eerder 15, met vorst en verwarming ruim 20.
 *
 * ⚠️ Aan de hoge kant kiezen is hier de veiligere fout, net als het naar boven afronden van de
 * minuten: te veel bereik beloven laat je met een lege accu langs de weg staan, te weinig kost je
 * niets. Daarom staat dit op 17,0 terwijl `log.md` het lager meet: 158 km tussen drie laadbeurten
 * door kostte 78 procentpunt, en dat is bij [USABLE_CAPACITY_KWH] 15,1 kWh/100 km. Wie het echt wil
 * weten, leest het gemiddelde verbruik van de boordcomputer en zet dat hier.
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
 * Het percentage dat er na [elapsedMs] laden ongeveer in zit, gestart op [fromPercent].
 *
 * ⚠️ [toPercent] zegt hier alleen *of* er te laden valt en is **geen plafond**: de auto kent jouw
 * doel niet — dat staat in een browser — en laadt door tot 100%. Tot 2026-09-20 klemde dit op het
 * doel, en toen bleef het scherm 90% melden terwijl het dashboard 98% zei.
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
  return Math.min(100, from + added);
}
