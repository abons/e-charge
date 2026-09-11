/**
 * De rekenkern: hoeveel energie er in moet, hoe hard die er in gaat, en hoe lang dat duurt.
 *
 * ⚠️ **Alles wat aan de auto of de lader hangt staat in deze drie constanten** — dat is met opzet
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
 * Een gewoon 230V-stopcontact met de meegeleverde kabel: 10 A × 230 V ≈ 2,3 kW *uit de muur*.
 * (De Leaf kan 6,6 kW AC aan, maar dat vraagt een laadpunt — niet dit scenario.)
 */
export const CHARGE_POWER_KW = 2.3;

/**
 * Rendement muur → batterij. Bij zo'n traag stopcontact is dit merkbaar slechter dan bij een
 * laadpunt: de vaste kosten van de boordlader, de BMS en (bij warm of koud weer) de koeling lopen
 * door terwijl er maar 2,3 kW doorheen gaat, dus die overhead is een groter aandeel. Gemeten
 * waarden voor een Leaf aan een stopcontact liggen grofweg tussen 85% en 90%; 88% is daar een
 * eerlijk midden in.
 *
 * Kalibreren gaat zo: laad één keer van bekend % naar bekend % en kijk hoeveel langer of korter
 * het duurde dan de app zei. 10% te lang → dit getal met ~10% omlaag.
 */
export const EFFICIENCY = 0.88;

/** De instellingen waarmee [estimate] rekent; de defaults zijn de constanten hierboven. */
export interface Setup {
  capacityKwh: number;
  powerKw: number;
  efficiency: number;
}

export const DEFAULT_SETUP: Setup = {
  capacityKwh: USABLE_CAPACITY_KWH,
  powerKw: CHARGE_POWER_KW,
  efficiency: EFFICIENCY,
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
 * meer kwijtkunnen, en 2,3 kW is daar zó ver onder dat de boordlader tot vlak onder 100% gewoon
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
