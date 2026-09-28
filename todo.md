# e-charge — openstaand werk

> **Alleen wat nog open is.** Het waarom staat in `design.md`, de regels in `CLAUDE.md`.

**Stand:** live op <https://abons.github.io/e-charge/> sinds 2026-09-11; 41/41 tests groen, bundel
~17 kB (2026-09-27). Pages staat aan en de deploy loopt: workflow-run 13 is groen en zette
`2ca50ed` neer (PR #9, de laadstandkeuze), precies wat er nu op `main` staat. In Chromium op
telefoonformaat doorlopen: leeg scherm, 43 → 90%, "laden niet nodig", klemmen op 0–100, doel dat een
reload overleeft, `morgen` over middernacht, de `.ics`-download, offline na een reload, de aftelling
na ⚡ Start laden (inclusief herstart en tussentijdse aflezing), het logboek (bewaren, aanvullen,
kopiëren, verwijderen), en de laadstand (wisselen vóór en tijdens het laden, herlaad, de stand in de
logregel). **Nog niet op een echte telefoon gezien.**

## Hier begint de volgende sessie

- **Draai `npm run kosten` zodra er een machine met netwerk aan de repo hangt.** De bouwsessies van
  Claude mogen `public.api.energyzero.nl` niet bereiken, dus elke regel die uit de app in `log.md`
  wordt geplakt zonder bedrag (een beurt bewaard zonder bereik, of vóór 2026-09-26) blijft leeg tot
  iemand het script lokaal draait. Eerst `-- --dry-run` om te kijken, dan zonder; daarna de diff
  nakijken en committen. `npm run calibrate` laat meteen de kosten per km zien.
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
- **Het laadvermogen staat op 3,5 kW, afgelezen op de lader zelf** (2026-09-13), en is sinds
  2026-09-20 het anker waar de capaciteit omheen gefit is — zie `design.md`. Dat verving de
  3,0 kW die uit het huisverbruik aan de meter was afgeleid; het display van het blok is directer
  bewijs dan een verschil in een meterstand, en 3,5 kW is ~15 A × 230 V. Wat nog open is: de lader
  toont wat hij *nu* trekt, niet het gemiddelde over zeven uur.
  Drie sessies teruggerekend (2026-09-20) geven 10,1 %/uur, maar daar staat de capaciteit óók in;
  het scheidt dus niets, en de aflezing op het blok blijft het enige harde getal.
  - Het blok hééft een standenknop (8 tot 16 A, 2026-09-27), en sinds die dag staat hij ook op het
    scherm. **Controleer de tussenstanden**: `CHARGE_CURRENTS_A` zegt 8/10/13/16, en 10 en 13 zijn
    aangenomen, niet afgelezen. Staat er iets anders op de knop, dan is het één regel in `charge.ts`.
  - **Eén beurt op 8 of 10 A in `log.md`** (de app zet de stand in `opm`) laat zien of het rendement
    op een lage stand echt lager is — de app rekent nu op elke stand met 0,88, en dat is voor 8 A
    aan de optimistische kant.
- **Zonder de kWh-kolom blijft het een product, geen paar.** Uit `(eind% − start%) × capaciteit ÷
  uren` komt `CHARGE_POWER_KW × EFFICIENCY` (3,08), niet de twee getallen apart — en sinds
  2026-09-20 hangt de capaciteit er ook nog aan: gemeten is `powerKw × efficiency ÷ capacityKwh`,
  dus 3,5 × 0,88 bij 30,5 kWh en 3,5 × 0,93 bij 32,2 kWh passen allebei even goed. Klopt de
  laadtijd, dan klopt het scherm; het bereik in km en de vraag of de stekker te zwaar belast wordt
  hangen wél aan de splitsing, en die maakt alleen een meterstand. Sinds 2026-09-13 vraagt de app
  niet meer om die stand (het veld is de aflezing in procenten geworden, zie `design.md`), dus die
  kolom vul je met de hand in `log.md` of hij blijft leeg.
- **Tel de capaciteitsstreepjes** rechts op het dashboard — gratis tegenproef, twaalf is nieuw en
  elk streepje is ~6,25%. De fit voorspelt er negen à tien (SoH ≈ 78%). Zijn het er twaalf, dan klopt
  er iets anders niet en moet dit opnieuw.
- ⚠️ **15 A door een gewoon stopcontact is over de grens.** De contactdoos achter de schuur is door
  de vorige bewoner geplaatst en niet nagekeken; schuko is voor korte pieken gemaakt, niet voor zes
  uur aan één stuk op 15 A. Met de aflezing van 3,5 kW is dit geen theoretisch punt meer: voel na
  een uur laden aan de stekker. Handwarm is normaal, te heet om vast te houden niet — dan hoort de
  kabel een stand lager — en die stand kies je sinds 2026-09-27 ook op het scherm, zodat de
  laadtijd meegaat (10 A → 2,2 kW, 13 A → 2,8 kW naar rato van de aflezing) — of er hoort een
  echt laadpunt te komen.
- **Vul `log.md`, en de aannames verdwijnen één voor één.** Drie van de vier constanten zijn
  geschat; het logboek vervangt ze door metingen zodra er sessies in staan (`npm run calibrate`).
  Eén regel geeft het effectieve laadvermogen (het product hierboven); diezelfde regel mét een
  meterstand erbij splitst het in vermogen en rendement, en twee opeenvolgende regels geven het
  verbruik, zonder de boordcomputer te hoeven geloven.
- **Het verbruik van 17,0 kWh/100 km is een boekwaarde**, en staat er bewust nog: het logboek meet
  15,2, maar te weinig bereik beloven kost niets en te veel wel. De boordcomputer van de Leaf toont je
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
