# Laadlog

> **Waarom dit bestand bestaat.** De app rekent met vier aannames (`src/core/charge.ts`), en drie
> daarvan zijn geschat. Dit logboek vervangt ze door gemeten waarden. Het is met opzet een bestand
> in deze repo en geen functie in de app: die weet niets van de auto en praat met geen enkele
> server — dat blijft zo. Jij noteert, git bewaart, `npm run calibrate` rekent.
>
> Het rijbereik van de boordcomputer hoort hier niet in. Dat is een voorspelling op grond van je
> laatste ritten, geen meting; het getal dat we wél kunnen meten is je verbruik, en dat volgt uit
> twee opeenvolgende regels hieronder.

## Bijhouden in de app

Onderaan het scherm staat het logboek: optionele velden voor **km-stand** en het **afgelezen
percentage**, een knop **💾 Bewaar laadbeurt** en de lijst van wat je bewaard hebt. Na het
afkoppelen vul je het percentage van het dashboard in, druk je op bewaren, en staat de beurt erin —
dat percentage wordt de `eind%` van de regel. Dezelfde beurt nog eens bewaren voegt niets toe maar
werkt hem bij — zo zet je de km-stand er later alsnog bij.

De `kWh`-kolom vult de app niet: ze weet niet wat je meter doet en toont zelf nergens een kWh. Heb
je die stand wel, schrijf hem dan met de hand in de tabel hieronder.

**📋 Kopieer hele logboek** zet alle regels op je klembord; plak ze hieronder onder de kop. Dat is
de stap die het duurzaam maakt:

⚠️ **De lijst in de app staat in `localStorage` op één telefoon.** Een herstart en een update
overleeft hij, maar het wissen van websitegegevens, een nieuwe telefoon of een andere browser niet.
Dit bestand in de repo is de kopie die blijft — plak dus af en toe.

De regel loopt vanaf het **insteken**, ook als je tussendoor het echte percentage hebt ingevuld en
de schatting opnieuw is verankerd. Kopieer of bewaar je na het afkoppelen, dan is het percentage in
het veld wat je van het dashboard las, en dát komt in de kolom `eind%`.

## Wat je noteert

Bij het **insteken**: de kilometerstand en het percentage. Bij het **afkoppelen**: het percentage,
en de klok van allebei de momenten. De meterstand is optioneel maar is het enige wat het rendement
kan vastpinnen — zonder die kolom blijven capaciteit en rendement onscheidbaar.

⚠️ **Alleen kWh van je meter in de kWh-kolom, en met de hand.** Het scherm toont nergens een kWh,
dus het veld dat er tot 2026-09-13 om vroeg leverde het enige andere getal op dat je op dat moment
bij de hand hebt: het percentage van het dashboard. Een 97 in deze kolom is erger dan een lege
kolom — `calibrate` rekent er een rendement en een laadvermogen uit terug die er precies zo uitzien
als een meting. Daarom vraagt de app nu om de aflezing in procenten, en leest
`withMeterAsPercent()` wat er al bewaard stond alsnog als aflezing zodra het geen kWh kán zijn
(`maxMeterKwh` in `src/core/charge.ts`). Een regel die alsnog fout staat, corrigeer je door hem te
verwijderen (×) en opnieuw te bewaren — een leeg veld overschrijft niets.

| kolom | wat | waarom |
| --- | --- | --- |
| `datum` | jjjj-mm-dd | volgorde, en om winter van zomer te onderscheiden |
| `km` | kilometerstand bij insteken | samen met de vorige regel: het verbruik |
| `start%` / `eind%` | dashboardpercentage | wat erin ging |
| `van` / `tot` | klok, `uu:mm` | de laadtijd |
| `kWh` | wat je meter over die periode telde | scheidt rendement van capaciteit |
| `opm` | bv. `vorst`, `elders geladen` | zie de waarschuwing onderaan |

## De sessies

| datum | km | start% | eind% | van | tot | kWh | opm |
| --- | --- | --- | --- | --- | --- | --- | --- |
<!-- Voeg hieronder één regel per laadbeurt toe, nieuwste onderaan. Voorbeeld (verwijder deze regel):
| 2026-09-12 | 84210 | 43 | 90 | 22:10 | 05:05 | 20,4 | |
-->
| 2026-09-13 | 96839 | 74 | 97 | 13:52 | 16:13 |  |  |

## Wat er dan uitkomt

`npm run calibrate` leest deze tabel en rekent terug:

- **Effectief laadvermogen** = (eind% − start%) × capaciteit / 100 ÷ uren → wat er in de accu ging.
- **Vermogen uit de muur** = kWh ÷ uren → vergelijk met `CHARGE_POWER_KW` (3,5).
- **Rendement** = (Δ% × capaciteit / 100) ÷ kWh → vergelijk met `EFFICIENCY` (0,88).
- **Verbruik** = (vorige `eind%` − deze `start%`) × capaciteit / 100 ÷ (deze `km` − vorige `km`)
  → vergelijk met `CONSUMPTION_KWH_PER_100KM` (17,0). Hier zit geen boordcomputer tussen.

⚠️ Die laatste klopt alleen als de auto tussen twee regels **nergens anders geladen** heeft en de
kilometerstand van hetzelfde moment komt als het percentage. Is dat niet zo, zet dan
`elders geladen` in `opm`; de berekening slaat die stap dan over.

⚠️ Capaciteit en rendement zijn van buitenaf niet te scheiden: je meet aan de muur wat erin gaat en
op het dashboard een percentage, maar hoeveel kWh de cellen in ging weet alleen de auto. Wat hier
uitkomt is dus de verhouding. Voor de vraag die de app stelt — hoe laat ben ik klaar — is dat genoeg;
wil je de twee apart, dan is de SoH (capaciteitsstreepjes op het dashboard) de ontbrekende helft.
