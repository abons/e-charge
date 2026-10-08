# e-charge — openstaand werk

> **Alleen wat nog open is.** Het waarom staat in `design.md`, de regels in `CLAUDE.md`.

**Stand:** live op <https://abons.github.io/e-charge/> sinds 2026-09-11; 92/92 tests groen
(2026-10-08). Pages staat aan en de deploy loopt: workflow-run 13 is groen en zette
`2ca50ed` neer (PR #9, de laadstandkeuze), precies wat er nu op `main` staat. In Chromium op
telefoonformaat doorlopen: leeg scherm, 43 → 90%, "laden niet nodig", klemmen op 0–100, doel dat een
reload overleeft, `morgen` over middernacht, de `.ics`-download, offline na een reload, de aftelling
na ⚡ Start laden (inclusief herstart en tussentijdse aflezing), het logboek (bewaren, aanvullen,
kopiëren, verwijderen), en de laadstand (wisselen vóór en tijdens het laden, herlaad, de stand in de
logregel). **Nog niet op een echte telefoon gezien.**

## Hier begint de volgende sessie

- **Startadvies en prijsgrafiek op de telefoon bekijken** (2026-10-08). Gezien in headless Chrome
  (412 en 320 px) met nagemaakte prijzen: de regel, de modal, de grens 07:00, de sessie-stand. **Niet
  gezien**: echte EnergyZero-prijzen, of morgen na 13:00 vanzelf binnenkomt (`ensureAhead`), slepen
  met een vinger (alleen muis getest), de Android-kiezer van "Auto klaar vóór". Leg één advies naast
  de Zonneplan-grafiek: de tijden moeten kloppen, de bedragen wijken af met de opslag.

- **De autokeuze op de telefoon bekijken** (2026-10-06): kenteken koppelen en de ⓘ-modal zijn op de
  telefoon gezien (79 tests). **Nog niet gezien**: merk/model/uitvoering kiezen in de dialoog en de
  zin "schatting uit accugrootte" in de ⓘ voor een nieuwe auto. Probeer een tweede auto zonder kenteken.
  - **Het meten in de eerste beurt** (`learnRate`) is unit-getest maar niet in een echte beurt gezien:
    zet een tweede auto aan de lader, voer na >= 30 min een aflezing in en kijk of de ⓘ
    "gemeten in de eerste beurt" zegt. Sinds de review telt alleen een echte aflezing als begin
    (`Session.real`): niet na een standwissel, niet als Huidig nog de schatting van een ⏹ is. De fixes
    uit die review (kenteken dubbel, Enter tijdens de opzoeking, oude `leaf`-keuze, `real`) zijn niet in een
    browser gezien: alleen `activeCar` is getest.
  - De accutabel (`evtable.ts`) heeft 118 uitvoeringen (31 merken): verversen met
    `node scripts/ev-data.mjs`; bron en MIT-licentie: open-ev-data. Dacia en Toyota staan met de hand
    in `evextra.ts` (7 uitvoeringen; Spring en bZ4X uit ev-database, C-HR+ en Urban Cruiser met WLTP × 1,2).

- **"Vergeten te starten? Voer achteraf in" en de regel onder 💾 op de telefoon bekijken**
  (2026-10-06). Gebouwd nadat een aflezing van 3 okt de afgesloten beurt van 27 sep overschreef.
  Gezien in een headless Chrome (foutmelding, bewaren, bedrag, oude beurt ongemoeid), niet op de
  telefoon: de regel onder de knoppen, de groene rand van het open blok, de date/time-kiezers van
  Android, en of het bedrag achteraf verschijnt voor een beurt van dagen terug.
- **Echte waarden in de geschatte logregels** (2026-10-06): 27 sep eind% 85 en km 97195, 2 okt
  start% 60 — in de app (× en opnieuw invoeren) én in `log.md`. De app slaat die regels sinds
  2026-10-06 zelf over (`geschat` in `opm`), dus er is geen vals getal meer; met echte waarden telt
  27 sep weer mee voor snelheid en bereik, en krijgt het km-paar van 26 → 27 sep en 27 sep → 2 okt
  zijn waarde terug.
- **De rekenkern op de telefoon: de twee paden die niet gezien zijn** (2026-10-06, geen aannames
  meer). Gezien op de telefoon (7 regels): voetregel "mediaan van 6 laadbeurten", "2,0 km per
  procentpunt uit 4 ritten", bijregel zonder "startwaarde", 43→80% geeft 3u 38m. **Niet gezien**,
  omdat het het echte logboek vervuilt: ⏹ zonder aflezing moet een regel met `geschat` bewaren die
  de snelheid niet verschuift (unit-getest; `huidigIsSchatting` in `main.ts`), en een beurt op 8 A
  moet "geschat uit 16 A" zeggen.

- **Draai `npm run kosten` zodra er een machine met netwerk aan de repo hangt.** De bouwsessies van
  Claude mogen `public.api.energyzero.nl` niet bereiken, dus elke regel die uit de app in `log.md`
  wordt geplakt zonder bedrag (een beurt bewaard zonder bereik, of vóór 2026-09-26) blijft leeg tot
  iemand het script lokaal draait. Eerst `-- --dry-run` om te kijken, dan zonder; daarna de diff
  nakijken en committen. `npm run calibrate` laat meteen de kosten per km zien.

## Openstaand

- **De laadstand op de telefoon bekijken** (2026-09-27). De keuzelijst is een gewone `<select>`
  met een eigen pijltje; Android opent daar zijn eigen kiezer voor, en of die vier regels
  (`10 A · 2,2 kW`) leesbaar zijn en de knop niet verspringt, is in Chromium niet te zien. Zet hem
  bij de volgende beurt op de stand waar de knop op het blok staat — de app rekent anders met
  3,5 kW terwijl er 1,75 stroomt.
- **De kostenregel weet niet dat de stroom van het dak komt.** Ze rekent elk kwartier tegen de
  afnameprijs; wie overdag op eigen zon laadt, betaalt in werkelijkheid de gemiste
  terugleverprijs van dat kwartier (bij Zonneplan de kale EPEX, midden op een zonnige dag vaak
  bijna nul). De regel overschat zo'n beurt dus. Het aandeel eigen opwek is zonder
  omvormerkoppeling niet te weten, en die past niet bij *de app weet niets van buiten* — dus dit
  blijft zo, tenzij een lagere stand op zonnige dagen (zie de laadstandkeuze in `design.md`)
  vaak genoeg voorkomt om er een "op eigen zon"-vinkje voor te willen. Dan is de som: dezelfde
  kwartieren tegen `allInEurPerKwh` zónder opslag en belasting.
- **De kostenregel op de telefoon nakijken** (2026-09-25, tweede poging). De eerste versie zei
  "geen prijzen"; de bron is nu `public.api.energyzero.nl`, waarvan een GitHub-runner de CORS-header
  voor `abons.github.io` heeft gezien en die 288 kwartieren per aanroep gaf. Open de app: er hoort
  een bedrag te staan met "EnergyZero" in de regel onderaan. Een laadbeurt die over 13:00 heen
  loopt naar morgen staat tot dan als "deels geschat".
- **De tariefconstanten controleren tegen je Zonneplan-rekening**: 1,652 ct opslag (excl. btw) en
  9,161 ct energiebelasting 2026 komen van vergelijkingssites, niet van de tariefkaart zelf. Eén
  kwartier in de Zonneplan-app naast de app leggen zegt genoeg; ze staan in `src/core/price.ts`.
- **Het laadvermogen staat op 3,5 kW, afgelezen op de lader zelf** (2026-09-13). Het is het enige
  getal van de kabel dat de app nog gebruikt, en alleen voor kWh en kosten; de laadtijd komt uit het
  logboek. Wat nog open is: de lader toont wat hij *nu* trekt, niet het gemiddelde over zeven uur.
  - Het blok hééft een standenknop (8 tot 16 A, 2026-09-27), en sinds die dag staat hij ook op het
    scherm. **Controleer de tussenstanden**: `CHARGE_CURRENTS_A` zegt 8/10/13/16, en 10 en 13 zijn
    aangenomen, niet afgelezen. Staat er iets anders op de knop, dan is het één regel in `charge.ts`.
  - **Twee beurten op 8 of 10 A in `log.md`** (de app zet de stand in `opm`) vervangen de schaling
    "geschat uit 16 A" door een eigen snelheid; tot dan is een lage stand een rekenregel en geen
    meting, en waarschijnlijk te optimistisch (de overhead van de boordlader).
- ⚠️ **15 A door een gewoon stopcontact is over de grens.** De contactdoos achter de schuur is door
  de vorige bewoner geplaatst en niet nagekeken; schuko is voor korte pieken gemaakt, niet voor zes
  uur aan één stuk op 15 A. Met de aflezing van 3,5 kW is dit geen theoretisch punt meer: voel na
  een uur laden aan de stekker. Handwarm is normaal, te heet om vast te houden niet — dan hoort de
  kabel een stand lager — en die stand kies je sinds 2026-09-27 ook op het scherm, zodat de
  laadtijd meegaat (10 A → 2,2 kW, 13 A → 2,8 kW naar rato van de aflezing) — of er hoort een
  echt laadpunt te komen.
- **Vul `log.md`, en de startwaarden verdwijnen.** De app rekent op je eigen beurten zodra er drie
  op 16 A afgelezen zijn (twee op een lagere stand, drie km-paren). Noteer bij het afkoppelen de
  het echte percentage van het dashboard — een beurt zonder aflezing telt niet mee — en bij het
  insteken de kilometerstand.
- **Het bereik komt uit septembercijfers.** 2,0 km per procentpunt is het gemiddelde van zomerse
  ritten; in de winter ligt het verbruik 20–30% hoger en de app toont dan te veel bereik. Het
  venster van 8 beurten laat koude ritten vanzelf meetellen, maar tot die er zijn is het getal
  optimistisch. Loggen in de winter, of het onderste kwartiel als voorzichtiger keuze (afgewezen,
  zie `design.md`).
- **De agenda-download op een echte telefoon.** In Chromium komt het `.ics` goed binnen, maar of
  Android hem aan de agenda-app aanbiedt (en of de melding meekomt) is niet te zien in een headless
  browser.

- **Het icoon**: sinds 2026-10-06 zijn er PNG's van 192 en 512 en een maskable (in het manifest),
  zodat Chrome er een echte app van maakt; de maskable is niet op een toestel bekeken.
- **Winterverlies is niet gemodelleerd.** Bij vorst gaat een deel van het vermogen naar het
  verwarmen van het pakket, en dan duurt laden langer dan deze app zegt. Het venster van de laatste
  8 afgelezen beurten laat dat vanzelf meetellen zodra er koude beurten in staan — een aparte factor
  is niet nodig, maar de eerste koude beurten zijn de proef.
