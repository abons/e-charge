# e-charge — project summary (for a fresh session)

Een laadcalculator voor een **Nissan Leaf 2019 40 kWh aan een stopcontact van ~3,5 kW**: één scherm,
plain TypeScript + DOM, PWA. De webkant van de familie is het model (`wordguesser-src/web/` —
esbuild, `web/`-shell, `src/core/` met pure modules); dit is de kleinste telg. Zelfde doc-split als
de zusters: `README.md` (wat/hoe bouwen), dit bestand (regels), `design.md` (keuzes), `todo.md`
(alleen wat open is).

## Standing rules

- **De app weet niets van de auto dat niet in zijn eigen logboek staat, en dat blijft zo.** Geen backend, geen login, geen cloud, geen
  Nissan API, geen OBD — dat was de opdracht bij het ontstaan (2026-09-11) en het is ook de reden dat
  deze app offline werkt en niets te onderhouden heeft.
- ⚠️ **Eén uitzondering, sinds 2026-09-25: de stroomprijs komt van het net.** De eigenaar wilde de
  laadkosten bij Zonneplan per kwartier zien, en die zijn niet te raden. `src/prices.ts` is de
  **enige** plek in de app die `fetch` aanraakt (`scripts/kosten.mjs` doet het ook, maar op jouw
  machine en alleen om oude logregels een bedrag te geven): de publieke prijzen-API van EnergyZero
  (`public.api.energyzero.nl/public/v1/prices`, EPEX per kwartier, zonder sleutel), resultaat in
  `localStorage`, hooguit één poging per kwartier en alleen als de laadbeurt buiten de bekende
  prijzen valt. Zonder bereik rekent alles door met wat er staat, en de kostenregel zegt "geen
  prijzen" in plaats van het scherm mee te slepen. Zonneplan zelf heeft geen open API; zijn prijs
  is EPEX + een vaste opbouw, en die drie getallen staan in `src/core/price.ts` — de
  tarief-tegenhanger van de vier autoconstanten. Wat nog steeds niet mag: een token of sleutel in
  de bundel (het is een publieke pagina), en iets ophalen dat niet de prijs is.
  ⚠️ **CORS test je niet vanaf een bureau, maar wél vanaf een GitHub-runner.** De eerste versie
  zei op de telefoon "geen prijzen": het oude `api.energyzero.nl/v1/energyprices` kent geen
  kwartieren (lege lijst bij `interval=3`), en Energy-Charts staat alleen zijn eigen origin toe.
  Dat kwam boven met een tijdelijke workflow die `curl -H "Origin: https://abons.github.io"` deed
  en de `access-control-allow-origin`-header afdrukte; de sessie-proxy van Claude blokkeert die
  hosts, een runner niet. Doe dat opnieuw vóór je van bron wisselt — en `price.value` is een string.
- ⚠️ **Tweede uitzondering, sinds 2026-10-06: een kenteken opzoeken bij RDW** (`src/car.ts`, alleen op
  "Zoek", open data, merk/model om te *tonen*, nooit om mee te rekenen). Logboek, sessie en laatst
  afgesloten beurt zijn **per auto** (`carKey` in `core/car.ts`); de Leaf houdt de oude sleutels,
  doel en laadstand zijn globaal. De Leaf-startwaarden gelden alleen voor de Leaf (`Start | null`:
  een andere auto heeft er geen tot hij eigen beurten heeft). Het kenteken staat nooit in een export,
  want `log.md` is publiek. Zie `design.md`.
- ⚠️ **Het logboek staat in de app én in de repo, en dat is geen dubbeling.** De app bewaart
  afgesloten laadbeurten in `localStorage` (`src/core/logbook.ts`) en zet ze met één knop op je
  klembord; `log.md` in de repo is de kopie die een gewiste browser of een nieuwe telefoon
  overleeft, en `npm run calibrate` rekent daaruit de constanten terug. Wat de app **niet** doet is
  ergens naartoe schrijven: geen server, geen token — een token in een publieke pagina is een gelekt
  token. Klembord is tekst, geen netwerk.
  ⚠️ De kolomvolgorde in `src/core/logline.ts` is een contract met `scripts/calibrate.mjs`, dat op
  positie leest en niet op naam — een test pint het formaat vast. Sinds 2026-09-26 staat er een
  `€`-kolom tussen `kWh` en `opm` (de kosten uit de kwartierprijzen, die de app zelf vult);
  `calibrate` slaat een regel zonder negen cellen over, met een waarschuwing — stil herschikken
  zette `opm` in de €-kolom bij een vergeten afsluitende `|`.
  ⚠️ **De app vraagt niet meer om een meterstand** (2026-09-13): het scherm toont nergens een kWh,
  dus dat veld leverde het enige andere getal op dat je bij de hand hebt — het dashboardpercentage,
  waar `calibrate` een rendement van maakt dat eruitziet als een meting. Het logboekveld is nu de
  *aflezing* (`eind%`); de `kWh`-kolom blijft in `log.md` en in het kolomcontract staan en vul je met
  de hand. `maxMeterKwh()` in `charge.ts` is daarmee geen invoerzeef meer maar de grens waarmee
  `withMeterAsPercent()` al bewaarde kWh-waarden alsnog als aflezing leest.
- ⚠️ **💾 werkt alleen een beurt bij die *vandaag* is afgekoppeld** (`bijwerkbaar()` in `main.ts`,
  2026-10-06). `finished` blijft in `localStorage` staan tot de volgende start, en een aflezing
  zonder lopende sessie overschreef daardoor ongemerkt de beurt van 27 sep (gelijke `startMs` is de
  sleutel van `withEntry`). Een vergeten beurt gaat via het klapblok "achteraf invoeren"
  (`manualEntry` in `logbook.ts`): altijd een eigen regel, nooit een aanvulling. Dat blok deelt
  *Afgelezen* en *Km-stand* met het gewone formulier en staat standaard dicht.
- ⚠️ **Een komma past niet in `<input type="number">`.** De browser maakt er stil een lege waarde
  van, en op een Nederlands toetsenbord is de komma nu juist wat je typt. Sinds 2026-09-13 heeft dit
  scherm geen decimaal veld meer (het meterstandveld werd een percentage, en dat is een heel getal),
  maar de regel blijft staan voor het volgende: een veld dat een decimaal getal aanneemt hoort
  `type="text"` met `inputmode="decimal"` te zijn; `optioneelGetal()` neemt komma én punt aan.
- ⚠️ **`logStartMs`/`logFrom` in de sessie zijn niet hetzelfde als `startMs`/`from`.** Die eerste
  twee zijn het moment van insteken en overleven het opnieuw verankeren bij een tussentijdse
  aflezing; zonder dat onderscheid zou de logregel een kortere laadbeurt melden dan er werkelijk
  was.
- ⚠️ **Geen aannames, alleen het logboek (2026-10-06, de eigenaar).** Capaciteit, rendement en
  verbruik zijn weg. `src/core/derive.ts` leidt uit het logboek af: de **laadsnelheid** (procentpunt
  per uur, mediaan over de laatste 8 bruikbare beurten, per stand) en de **kilometers per
  procentpunt** (gepoold over opeenvolgende regels, met een rit die >1,35× van de mediaan afwijkt
  weggelaten). Met te weinig beurten (3 op 16 A, 2 op een lagere stand, 3 geldige paren) gelden de
  **startwaarden** `START_RATE_PP_PER_H` en `START_KM_PER_PP` — hard schakelen, geen gewogen mix — en
  een test legt vast dat ze overeenkomen met de momentopname `test/fixtures/log-2026-10-06.md` (niet
  het levende `log.md`: een datacommit mag de build niet breken; `npm run calibrate` waarschuwt bij >5%). Het scherm
  zegt waar het getal vandaan komt ("startwaarde", "geschat uit 16 A", of de voetregel). Alles in
  `charge.ts` dat nog een getal is, is een **aflezing van de kabel**: `CHARGE_POWER_KW` (3,5 kW op
  16 A, voor kWh en kosten) en de laadstanden. Reken nooit met een vast getal in `main.ts` of in de
  HTML. De `<select id="amps">` in de HTML is **leeg**; `main.ts` vult hem uit `CHARGE_CURRENTS_A`.
- ⚠️ **Een beurt telt alleen mee als zijn `eind%` is afgelezen (`Entry.estimated`).** ⏹ en 💾 zonder
  aflezing bewaren de regel nog wel (km en tijden zijn echt), maar met `estimated` en `geschat` in
  `opm` (`16 A; geschat`): zo'n regel telt niet voor snelheid en bereik, anders bevestigt een mediaan
  alleen zijn eigen schatting. `huidigIsSchatting` in `main.ts` weet of Huidig de schatting is die ⏹
  erin zette of iets dat jij intikte (het leeft alleen in het geheugen, dus `#current` heeft
  `autocomplete="off"`: de app herlaadt zichzelf na een update en Chrome zette de schatting anders
  terug als aflezing); een echte aflezing wint altijd van een schatting, ook van wat
  al bewaard was. Beurten die op 99–100% eindigen tellen niet voor de snelheid (de duur is
  afgekapt). `isUnreliableNote` (`geschat`, `elders geladen`) doet hetzelfde voor `log.md`.
- ⚠️ **De laadstand zit in de sessie, en `setup()` in `main.ts` is de enige weg naar een `Setup`.**
  Een `Setup` is `{ ratePpPerHour, powerKw, kmPerPp }` uit `setupAt(amps, logbook)` in `derive.ts`;
  alles wat rekent (`estimate`, `percentAfter`, `rangeKm`, `eurPerKm`, `chargingCost`, de
  agenda-tekst, de logregel) krijgt hem mee. Tijdens het laden is dat de stand van de sessie, en een
  andere keuze in de lijst verankert de sessie opnieuw vanaf het gerekende percentage van nu — net
  als een aflezing. In het logboek gaat de stand als `16 A` de `opm`-kolom in — géén eigen kolom,
  want de kolomvolgorde is een contract — via `noteFor`/`noteForAmps`/`ampsFromNote` in `logline.ts`
  (één test pint de round-trip vast); een regel zonder stand is van vóór de standenkeuze en telt als
  de hoogste, een regel met een stand die de knop niet heeft (`12 A`) wordt overgeslagen en
  gemeld. `src/core/logmd.ts` leest `log.md` met dezelfde regels, voor `calibrate`, `kosten` en de
  tests — nooit de app zelf.
- ⚠️ **Geen taper-model, en dat is een keuze, geen vergeten werk.** Bij een paar kW gaat de boordlader
  tot vlak onder 100% gewoon door; lineair is hier eerlijker dan een afknik-curve die doet alsof er
  meer bekend is. Zou de app ooit snelladen erbij krijgen, dan is dát het moment voor een curve —
  zie `design.md`.
- ⚠️ **`estimate()` rondt minuten naar boven.** Een halve minuut te weinig laden is een verkeerd
  antwoord; "±" staat er niet voor niets bij het bereik. `rangeKm` rondt naar beneden.
- **Lokale tijd is hier de juiste tijd** — anders dan bij de zusters, waar UTC een contract tussen
  apparaten is. Dit is een stekker in één huis: de keukenklok telt. `src/core/time.ts` gebruikt dus
  bewust de `getHours()`-familie en geen UTC.
- **De UI is Nederlands** (zie `design.md`), anders dan Word Guesser — daar was Engels een
  familiebesluit over een spel in zestien talen; dit is één gereedschap voor één garage.
- ⚠️ **Twee standen, en het verschil is één vraag: staat de stekker er al in?** Zonder lopende
  sessie is "Start" de klok van nu, en schuift de eindtijd dus mee met de tijd — juist zolang je nog
  niet ingestoken bent, fout zodra dat wel zo is. `⚡ Start laden` zet het moment vast in
  `localStorage`; vanaf dan telt de app af en loopt "Nu ongeveer" gerékend op. Een percentage dat je
  tijdens het laden intypt is een *aflezing van de auto* en verankert de sessie opnieuw vanaf nu.
- ⚠️ **Het logboek is een `<details id="logbook">` onder de knoppen, standaard dicht (2026-10-06).**
  `main.ts` opent het bij laden als er een sessie loopt of een beurt `bijwerkbaar()` is, bij ⏹ Stop
  en bij elke `toonLogMelding` — **nooit in `render()`** (dat tikt elke 15 s en zou een handmatig
  dichtklappen terugdraaien). `km`, `logpct`, 💾, `lognote` en `savetarget` zitten erin, dus een
  nieuwe melding in dat blok moet het ook openen. Alle ids blijven bestaan: `main.ts` pakt ze zonder
  null-check, een weggehaald element is een crash bij laden. Bereik, laadvermogen en kosten per km
  staan sindsdien samen in één grijze `.sub`-regel (`nowrap`, dus geen hoogtesprong).
- ⚠️ **De indeling staat omgekeerd, voor de rechterduim (2026-10-06):** resultaten bovenaan, daaronder
  de resultaten als `flex: 1`-kolom (`.out`): de regels groeien mee met de vrije ruimte tot een
  maximum (64 px, de hero 88 px met een cijfer van 28–36 px) en een eventuele rest staat bovenin, dus
  geen lege strook en geen gat tussen uitkomst en invoer. Zet daar nooit `min-height: 0` op: dan
  verspringen de knoppen. ⚠️ Een logboek dat opent (tik op ⏹, of een melding) schuift de knoppen wél
  omhoog zolang de kaart gestrekt is — de claim "open/dicht verschuift nooit iets" geldt alleen bij een
  vol scherm. Dan Doel | Huidig (CSS `order`; in de HTML staat
  Huidig eerst), Laadstand, knoppen, meldingsslot, logboek. `main` is een flex-kolom van 100% (`html`/`body`) en de
  viewport-meta heeft `interactive-widget=resizes-content`: zonder dat schuift Chrome de hele pagina
  ~217 px omhoog zodra het toetsenbord opent (gemeten op de telefoon: titel en uitkomst uit beeld,
  terwijl onder Huidig ruimte genoeg was); nu krimpt het viewport en geeft de ruimte erboven mee. Bij
  sluiten zakken de knoppen weer, dus tik pas na ✓. (`100svh` is losgelaten: het volgt het
  toetsenbord niet.) Omdat de invoer nu ónder de resultaten staat, houden twee dingen hun plek: `#nowline`
  blijft in de lay-out als hij verborgen is (`#nowline[hidden]` is `display:flex; visibility:hidden`,
  dus **controleer `visibility`, niet `display`**) en `#note` zit in `.noteslot` met een vaste hoogte
  van twee regels — houd meldingen onder twee regels. Een melding onder de knoppen zonder slot duwt
  de knoppen omhoog, want de ruimte erboven krimpt. Past de pagina niet in het scherm (browsertab,
  groot lettertype) dan werkt de ruimte niet en schuift alles weer mee.
- ⚠️ **Niets boven de knoppen mag van hoogte veranderen.** De meldingsregel staat ónder `.actions`
  omdat een `change` bij het verlaten van een invoerveld de melding kan tonen of verbergen terwijl
  je een knop indrukt; alles eronder verschuift dan tussen aanraken en loslaten, en je tik landt
  naast de knop. In Chromium gereproduceerd: de klik op ⏹ Stop kwam niet aan.
- ⚠️ **`el.hidden` werkt alleen als de CSS het toelaat.** Eigen regels met `display` (zoals
  `.line { display: flex }`) verslaan de `display: none` die het `hidden`-attribuut uit de
  browser-stylesheet krijgt. Daarom staat er een expliciete `[hidden] { display: none !important; }`
  ná die regels. Controleer verborgen dingen met `getComputedStyle(...).display` en niet met de
  `.hidden`-property — die stond hier op `true` terwijl de regel gewoon in beeld bleef.
- ⚠️ **`render()` raakt de invoervelden niet aan.** De opmaak staat in `web/index.html`, JS schrijft
  alleen tekst in de plekken die veranderen. De schermklok tikt door (elke 15 s, en op
  `visibilitychange`), en een render die de invoer opnieuw opbouwt gooit je cursor uit het veld dat
  je aan het typen bent. Alleen `change` (bij het verlaten van een veld) mag een waarde normaliseren.
- ⚠️ **`sw.js`'s VERSION wordt door `scripts/build.mjs` gestempeld, niet door de bron.** In
  `web/sw.js` staat letterlijk `v1`; elke build (ook `serve`) vervangt dat door de commit
  (`GITHUB_SHA` in CI) of de klok tot op de milliseconde, dus een deploy zet zichzelf door. **Laat
  die letterlijke regel staan zoals hij staat** — andere quotes of een `let` en de build vindt hem
  niet meer; hij gooit dan wel een fout in plaats van stil `v1` te laten staan. Wat er *nog* fout
  kan: binnen één draaiende `npm run serve` blijft die stempel gelijk, dus na een rebuild in
  dezelfde sessie kan een tab nog de oude bundel serveren.
  Herstart dan serve, of gooi de worker weg
  (`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()` plus
  `for (const k of await caches.keys()) await caches.delete(k)`) voordat je gelooft dat code stuk
  is. Dit heeft bij Word Guesser uren gekost; zie zijn `CLAUDE.md`.
- **Publiceren gaat automatisch**, anders dan bij de zusters (die een dist-repo met een
  `publish.mjs` hebben): `.github/workflows/pages.yml` bouwt bij elke push naar `main` en zet
  `build/` op Pages, met de tests ervóór. Er is dus geen handmatige go-live en geen dist-diff meer
  om te reviewen — de assurantie is de groene workflow.

## Build / run

`npm install` één keer, dan `npm test` (type-check + rekentests), `npm run build` (→ `build/`),
`npm run serve` (lokaal). Publiceren doet `.github/workflows/pages.yml` bij elke push naar
`main`; eenmalig moet Settings → Pages → Source op "GitHub Actions" staan.
