import type { EvRow } from "./evtable.js";

/**
 * Wat open-ev-data (`evtable.ts`, gegenereerd) niet heeft: Dacia en Toyota. Met de hand bijgehouden en
 * dus apart, zodat `scripts/ev-data.mjs` ze niet overschrijft. Zelfde kolommen als `evtable.ts`:
 * [id, merk, model, uitvoering, jaar, bruikbare accu kWh, verbruik kWh/100 km, boordlader AC kW].
 *
 * Bronnen, opgezocht op 2026-10-06:
 * - Dacia Spring: ev-database.org (bruikbare accu 25,0 / 25,0 / 24,0 kWh; verbruik in de praktijk
 *   152 / 156 / 150 Wh/km; boordlader 6,6 kW).
 * - Toyota bZ4X FWD: ev-database.org (bruikbaar 64,0 kWh; 183 Wh/km in de praktijk).
 * - Toyota C-HR+ en Urban Cruiser: de datasheets via nextpit.de geven alleen het fabrieksverbruik
 *   (WLTP: 13,4 en 15,1 kWh/100 km) en de netto accu (54, 72 en 60 kWh). ⚠️ Het verbruik hieronder is dat
 *   getal × 1,2: in de praktijk ligt het verbruik hoger dan op papier, en de rest van de tabel is
 *   praktijkverbruik. Een aanname, net als de 85% in `evest.ts`; het bereik is daar dus grover.
 *
 * Een jaar dat niet uit de bron blijkt staat op `null` (de keuzelijst laat het dan weg).
 */
export const EV_EXTRA: readonly EvRow[] = [
  ["extra-dacia-spring-45", "Dacia", "Spring", "Electric 45", 2021, 25.0, 15.2, 6.6],
  ["extra-dacia-spring-65", "Dacia", "Spring", "Electric 65", 2021, 25.0, 15.6, 6.6],
  ["extra-dacia-spring-100", "Dacia", "Spring", "Electric 100", null, 24.0, 15.0, 6.6],
  ["extra-toyota-bz4x-fwd-64", "Toyota", "bZ4X", "FWD 64 kWh", 2022, 64.0, 18.3, null],
  ["extra-toyota-chr-plus-54", "Toyota", "C-HR+", "57,7 kWh", 2025, 54, 16.1, null],
  ["extra-toyota-chr-plus-72", "Toyota", "C-HR+", "77 kWh", 2025, 72, 16.1, null],
  ["extra-toyota-urban-cruiser-60", "Toyota", "Urban Cruiser", "61 kWh", 2025, 60, 18.1, null],
];
