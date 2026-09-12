# e-charge — openstaand werk

> **Alleen wat nog open is.** Het waarom staat in `design.md`, de regels in `CLAUDE.md`.

**Stand:** live op <https://abons.github.io/e-charge/> sinds 2026-09-11 (24/24 tests groen, gemeten
2026-09-12; bundel ~7 kB). Pages staat aan en de deploy loopt: de laatste workflow-run is groen en
zette `bcfa190` neer, precies wat er nu op `main` staat. ⚠️ **Hieronder stond tot 2026-09-12 nog een
open punt dat Settings → Pages → Source met de hand om moest** — dat gebeurde op 2026-09-11 al, te
zien aan de twee gefaalde runs van 10:02 en 10:06 tegen de geslaagde van 10:13.

In Chromium op telefoonformaat doorlopen: leeg scherm, 43 → 90%, "laden niet nodig", klemmen
op 0–100, doel dat een reload overleeft, `morgen` over middernacht, de `.ics`-download, offline na
een reload, de aftelling na ⚡ Start laden (inclusief herstart en tussentijdse aflezing), en het
logboek (bewaren, aanvullen, kopiëren, verwijderen). **Nog niet op een echte telefoon gezien.**

## Hier begint de volgende sessie

- ⚠️ **Het laadvermogen staat op 3,0 kW op grond van één ruwe aflezing** (2026-09-11): het
  huisverbruik ligt tijdens het laden ~3 kWh per uur hoger, en 3 kW is 13 A. Dat is aannemelijker
  dan de 2,3 kW (10 A) waar de app mee begon, maar het is een *meterschatting*, geen meting van de
  sessie. Twee manieren om het hard te maken, allebei klein:
  - **Kijk op het blok van de laadkabel** — daar staat de ampèrage, vaak met een standenknop
    (8/10/13/16 A). Dat is direct bewijs, geen afleiding.
  - **Reken één sessie terug:** `(doel% − start%) × 0,39 ÷ uren` = effectief kW, gedeeld door
    `EFFICIENCY` = het vermogen uit de muur. Dat pint meteen ook het rendement vast, de helft die nu
    nog ongemeten is.
- ⚠️ **13 A door een gewoon stopcontact is de grens.** De contactdoos achter de schuur is door de
  vorige bewoner geplaatst en niet nagekeken; schuko is voor korte pieken gemaakt, niet voor zeven
  uur aan één stuk op 13 A. Voel na een uur laden aan de stekker: handwarm is normaal, te heet om
  vast te houden niet. In dat geval hoort de kabel een stand lager (10 A → 2,3 kW, en dan gaat
  `CHARGE_POWER_KW` mee terug), of er hoort een echt laadpunt te komen.
- **Vul `log.md`, en de aannames verdwijnen één voor één.** Drie van de vier constanten zijn
  geschat; het logboek vervangt ze door metingen zodra er sessies in staan (`npm run calibrate`).
  Eén regel is al genoeg voor rendement en laadvermogen; twee opeenvolgende regels geven het
  verbruik, zonder de boordcomputer te hoeven geloven.
- **Het verbruik van 17,0 kWh/100 km is een boekwaarde.** De boordcomputer van de Leaf toont je
  eigen gemiddelde (in **km/kWh** — 5,9 km/kWh is 17 kWh/100 km, 6,5 is 15,4). Eén blik daarop en
  het bereik op het scherm klopt met jouw rijstijl in plaats van met een gemiddelde Nederlander.
  Let op het seizoen: hetzelfde getal is in januari een ander getal dan in juli.
- **De agenda-download op een echte telefoon.** In Chromium komt het `.ics` goed binnen, maar of
  Android hem aan de agenda-app aanbiedt (en of de melding meekomt) is niet te zien in een headless
  browser.

## Openstaand

- **Het icoon is één SVG.** Goed genoeg voor de favicon en voor Chrome's installatie, maar een
  maskable launcher-icoon knipt een vol vierkant af; een echt PNG-paar (192/512) vraagt een oog op
  een toestel. Zelfde open punt als bij Word Guesser.
- **Winterverlies is niet gemodelleerd.** Bij vorst gaat een deel van het vermogen naar het
  verwarmen van het pakket, en dan duurt laden langer dan deze app zegt. Dat is eerlijk op te lossen
  met één extra factor, maar niet zonder een winter aan metingen — tot die tijd is `EFFICIENCY`
  bijdraaien de betere knop.
