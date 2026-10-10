# Laadlog

> **Waarom dit bestand bestaat.** Sinds 2026-10-06 rekent de app zonder aannames: de laadsnelheid
> (procentpunt per uur) en de kilometers per procentpunt komen uit **dit logboek** (`src/core/derive.ts`),
> en alleen waar het te weinig beurten heeft gelden startwaarden die uit deze tabel zijn afgeleid. Het
> is met opzet een bestand in deze repo en geen functie in de app: die praat met geen enkele server —
> dat blijft zo. Jij noteert, git bewaart, `npm run calibrate` toont wat de app eruit afleidt.
>
> Het rijbereik van de boordcomputer hoort hier niet in. Dat is een voorspelling op grond van je
> laatste ritten, geen meting; het getal dat we wél kunnen meten volgt uit twee opeenvolgende regels
> hieronder (kilometers per procentpunt).
>
> **Welke regels tellen mee.** Alleen een regel waarvan `eind%` van het dashboard is **afgelezen**. Een
> regel met `geschat` in `opm` (de app schrijft dat als je ⏹ of 💾 drukt zonder aflezing, of schrijf het
> zelf bij een getal of tijd bij benadering) blijft staan, maar telt niet. Een beurt die op 99–100%
> eindigt telt niet voor de snelheid: de lader was eerder klaar dan je afkoppelde. `elders geladen` laat
> het verbruik tussen twee regels buiten beschouwing.

## Bijhouden in de app

Onderaan het scherm staat het logboek: optionele velden voor **km-stand** en het **afgelezen
percentage**, een knop **💾 Bewaar laadbeurt** en de lijst van wat je bewaard hebt. Na het
afkoppelen vul je het percentage van het dashboard in, druk je op bewaren, en staat de beurt erin —
dat percentage wordt de `eind%` van de regel. Dezelfde beurt nog eens bewaren voegt niets toe maar
werkt hem bij — zo zet je de km-stand er later alsnog bij.

De `kWh`-kolom vult de app niet: ze weet niet wat je meter doet en toont zelf nergens een kWh. Heb
je die stand wel, schrijf hem dan met de hand in de tabel hieronder. De `€`-kolom vult de app wél
(sinds 2026-09-26): de kosten van de beurt uit de kwartierprijzen van Zonneplan, alleen als elk
kwartier een prijs had — een deels geschat bedrag hoort hier niet. Voor regels van daarvóór, of
regels die om een andere reden geen bedrag kregen, doet `npm run kosten` hetzelfde achteraf: het
haalt de prijzen van die dag op en schrijft het bedrag in de lege cel (`-- --dry-run` laat het
alleen zien).

**📋 Kopieer hele logboek** zet alle regels op je klembord; plak ze hieronder onder de kop. Dat is
de stap die het duurzaam maakt:

⚠️ **De lijst in de app staat in `localStorage` op één telefoon.** Een herstart en een update
overleeft hij, maar het wissen van websitegegevens, een nieuwe telefoon of een andere browser niet.
Dit bestand in de repo is de kopie die blijft — plak dus af en toe.

Sinds 2026-09-27 zet de app ook de **laadstand** van de kabel in `opm` (`16 A`): `calibrate` en
`kosten` lezen hem daar uit, en een regel zonder stand — alles van daarvóór — telt als de hoogste.
Een beurt op 8 of 10 A hoort dus niet zonder die opmerking in de tabel.

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
| `€` | wat de beurt kostte bij Zonneplan, uit de kwartierprijzen | de app vult dit; samen met de volgende regel: kosten per km |
| `opm` | bv. `vorst`, `elders geladen`, en de laadstand `10 A` (de app vult die) | zie de waarschuwing onderaan; de stand houdt beurten op 8 A en 16 A uit elkaar |

## De sessies

| datum | km | start% | eind% | van | tot | kWh | € | opm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-13 | 96839 | 74 | 97 | 13:52 | 16:13 |  | 2,54 |  |
| 2026-09-17 | 96928 | 55 | 90 | 11:47 | 15:12 |  | 2,05 |  |
| 2026-09-20 | 96997 | 54 | 98 | 11:02 | 15:23 |  | 1,95 |  |
| 2026-09-25 | 97125 | 40 | 73 | 18:14 | 21:12 |  | 4,71 |  |
| 2026-09-26 | 97191 | 34 | 64 | 13:13 | 15:56 |  | 1,60 |  |
| 2026-09-27 | 97195 | 65 | 85 | 10:31 | 12:48 |  | 1,06 | 16 A; eind% en km geschat (overschreven, hersteld 2026-10-06) |
| 2026-10-02 | 97280 | 60 | 100 | 11:00 | 15:00 |  | 4,32 | 16 A; start% geschat, tijden bij benadering |
| 2026-10-08 |  | 47 | 80 | 09:57 | 15:11 |  | 2,85 | 10 A; geschat (eind% herleid uit de app, km onbekend; hersteld 2026-10-10) |
| 2026-10-10 | 97485 | 66 | 90 | 11:54 | 15:43 |  | 1,06 | 10 A |

De eerste drie beurten gaven de eerste fit van de laadsnelheid (2026-09-20, zie `design.md`): samen
102 procentpunt in 10u07 (10,08 %/uur) en 158 km voor 78 procentpunt. De twee regels met `geschat`
(27 sep en 2 okt) tellen niet mee. De `kWh`-kolom is nog leeg en hoeft niet gevuld. De `€`-kolom is achteraf
gevuld met `npm run kosten` (2026-09-26): overdag laden kostte 13–17 ct/kWh, de avondbeurt van 25
september 45 ct/kWh — het verschil tussen zon en piek in één tabel.

## Wat er dan uitkomt

`npm run calibrate` leest deze tabel met dezelfde functies als de app en toont:

- **Laadsnelheid** = (eind% − start%) ÷ uren, per beurt en per stand → de mediaan van de laatste 8
  bruikbare beurten is wat de app gebruikt. Zonder eigen beurten op een lagere stand schaalt de app
  de snelheid van 16 A mee met de kabelverhouding (8 A is de helft) en zegt dat.
- **Kilometers per procentpunt** = (km van de volgende regel − km van deze) ÷ (eind% van deze − start%
  van de volgende), gepoold over de geldige paren. Een paar dat meer dan 1,35 keer van de mediaan
  afwijkt valt weg (de auto is dan vermoedelijk elders bijgeladen of een km-stand klopt niet).
- **Kosten per km** = prijs per kWh × (kW uit de muur ÷ laadsnelheid) ÷ kilometers per procentpunt.
  Het kabelvermogen (3,5 kW op 16 A) is een aflezing van het display; het staat niet in deze tabel.

⚠️ De km-paren kloppen alleen als de auto tussen twee regels **nergens anders geladen** heeft en de
kilometerstand van hetzelfde moment komt als het percentage. Is dat niet zo, zet dan `elders geladen`
in `opm`; het paar wordt dan overgeslagen.

⚠️ Er is geen kWh-meter nodig en er komt ook geen rendement of capaciteit uit: die zijn van buitenaf
niet te scheiden, en de app heeft ze niet nodig om te zeggen hoe laat je klaar bent of hoe ver je komt.
De `kWh`-kolom blijft een vrije kolom voor wie zijn meterstand wil bijhouden.
