# e-charge — ontwerpkeuzes

> Eén keuze per notitie, zelfde opzet als de zusters. Kort, want deze app is klein en hoort klein
> te blijven.

## De app weet niets van de auto — 2026-09-11

Bij het ontstaan was dit expliciet: geen backend, geen login, geen cloud, geen Nissan API, geen OBD,
geen externe service. Dat is niet alleen een beperking maar het hele ontwerp: wat je overhoudt is
een rekenmachine met twee invoervelden, en die werkt offline, gaat nooit stuk door een API die
verandert, en heeft niets te onderhouden. Wie ooit "maar dan haalt hij het percentage zelf op" wil,
bouwt een andere app.

## Lineair rekenen, geen laadcurve — 2026-09-11

Een laadcurve hoort bij snelladen: daar knijpt de auto af zodra de cellen het vermogen niet meer
kwijtkunnen. Een paar kW zit daar zó ver onder dat de boordlader tot vlak onder 100% constant doorgaat.
Een curve zou hier dus doen alsof er meer bekend is dan waar is. De verliezen zitten in één
rendementsfactor (`EFFICIENCY`), en die is meetbaar met één laadsessie — een curve niet.

## De constanten staan in één bestand — 2026-09-11

Alle auto- en laderkennis staat boven in `src/core/charge.ts`: bruikbare capaciteit, laadvermogen,
rendement — en sinds *Kilometers zijn een vierde constante* hieronder ook het verbruik. De UI leest
ze (ook voor de regel onderaan het scherm en de agenda-tekst) en rekent nergens zelf met een vast
getal. Daarom past een andere Leaf, een andere auto of een laadpunt in één regel, en kan het scherm
niet iets anders beweren dan de rekenkern.

## Minuten naar boven — 2026-09-11

`estimate()` rondt naar boven af. Bij een schatting met een rendementsfactor erin is te vroeg komen
de duurdere fout: dan sta je bij de auto en is hij niet klaar. Het scherm zegt daarom ook `±` bij
het vermogen.

## Lokale tijd, geen UTC — 2026-09-11

De zusters rekenen in UTC omdat het dagwoord een contract tussen apparaten is. Hier is niets een
contract: het is een stekker in één huis, en de vraag is hoe laat het op de keukenklok is als de
auto klaar is. `src/core/time.ts` gebruikt daarom bewust lokale tijd, en de eindtijd krijgt
`morgen`/`overmorgen` erachter zodra hij over middernacht schuift — 02:32 zonder dat woordje is een
verkeerd antwoord.

## De UI is Nederlands — 2026-09-11

Word Guesser is met opzet Engels: dat is een spel in zestien talen, en de taal zit in de woordlijst
en niet in de UI. Deze app is één gereedschap voor één garage, en de opdracht was Nederlands. Dus
`lang="nl"`, komma's in de decimalen, en `9u 04m`.

## De agenda is een `.ics`-download, op de eindtijd — 2026-09-11

"Zet in agenda" kan zonder backend maar op één manier: een `.ics` genereren en de agenda-app van de
telefoon die zelf laten openen. Twee keuzes daarbinnen:

- De afspraak staat **op het klaar-moment** (een kwartier lang), niet over de hele laadsessie heen.
  Het is de eindtijd die je wilt weten, en een melding op het begin van een afspraak (`TRIGGER:PT0S`)
  wordt door elke agenda geïmporteerd — een melding aan het *eind* (`TRIGGER;RELATED=END`) niet.
- Tijden gaan in UTC (`...Z`) het bestand in, zodat er geen `VTIMEZONE`-blok mee hoeft. Dat is de
  enige plek in de app waar UTC voorkomt; het scherm blijft lokaal.

## Plannen en bezig zijn twee standen — 2026-09-11

De app begon als planner: "Start" is de klok van nu, en die tikt door. Dat beantwoordt *"als ik nú
insteek, hoe laat ben ik klaar?"* — en dat is precies fout zodra de stekker er al in zit, want dan
schuift "Klaar rond" mee met de tijd terwijl de auto gewoon aan het laden is. Gemeten: 43% ingevuld
om 10:35 gaf klaar om 17:32, en drie uur later zei hetzelfde scherm 20:32.

`⚡ Start laden` legt daarom het moment vast (in `localStorage`, anders overleeft een aftelling het
wegbergen van je telefoon niet). Vanaf dan staat de eindtijd stil en loopt "Nu ongeveer" op. Dat
oplopende percentage is gerékend en niet gemeten — de app weet nog steeds niets van de auto — en
daarom verankert een percentage dat je tijdens het laden intypt de sessie opnieuw: jouw aflezing
wint van onze schatting, en het verschil is meteen de fout in capaciteit × rendement.

`percentAfter()` is daarmee `estimate()` achterstevoren, en een test pint vast dat ze elkaars
omgekeerde zijn: wat `estimate()` als laadtijd geeft, moet `percentAfter()` exact op het doel
uitbrengen. Anders zegt de aftelling iets anders dan de eindtijd erboven.

## Kilometers zijn een vierde constante — 2026-09-11

Bereik in km vraagt een verbruik, en dat is uit de andere drie niet af te leiden.
`CONSUMPTION_KWH_PER_100KM = 17,0` is gemengd Nederlands rijden voor een Leaf 40 kWh; in de zomer
eerder 15, met vorst ruim 20. Aan de hoge kant kiezen is hier de veiligere fout, om dezelfde reden
dat de minuten naar boven gaan en `rangeKm()` naar beneden afrondt: te veel bereik beloven laat je
langs de weg staan, te weinig kost niets.

## Het logboek staat op twee plekken, met opzet — 2026-09-11

De app bewaart afgesloten laadbeurten zelf (`localStorage`), en `log.md` in de repo blijft de
duurzame kopie. Dat is geen dubbeling maar een taakverdeling: in de schuur, 's avonds, met koude
handen, moet bewaren één knop zijn — een bestand in een repo bewerken is dat niet. Omgekeerd is
`localStorage` geen archief: het overleeft een herstart en een update, maar niet het wissen van
websitegegevens of een nieuwe telefoon. Eén knop kopieert het hele logboek als tabelregels; plakken
is dan het enige handwerk dat overblijft.

Wat de app níet doet is ergens naartoe schrijven. Een commit vanuit de pagina vraagt een token in
publieke code, en dat is een gelekt token; bovendien zou het netwerk terugbrengen in een app die
volledig offline werkt. Het klembord is tekst, geen verbinding.

Bewaren is idempotent op starttijd: dezelfde laadbeurt nog eens bewaren werkt de regel bij in plaats
van er een tweede naast te zetten. Dat is nodig omdat de knop blijft staan en de afgelopen beurt een
herstart overleeft — en het is meteen de manier om de km-stand later alsnog toe te voegen.

## Het logboek vraagt een percentage, geen meterstand — 2026-09-13

De `kWh`-kolom van het logboek is de enige invoer van deze app die niemand ooit terugleest voordat
er conclusies uit volgen: `npm run calibrate` maakt er rendement en laadvermogen van, en die
getallen zien er hetzelfde uit of ze nu van een meter komen of niet. Precies dat ging mis — het
dashboardpercentage (97) belandde in het veld, omdat het scherm nergens een kWh toont en dat het
enige andere getal is dat je op dat moment in je hand hebt.

Een zeef op het veld was het eerste antwoord, en het tweede is beter: het veld vraagt nu om de
**aflezing in procenten** en wordt de `eind%` van de regel. Dat is het getal dat je bij het
afkoppelen werkelijk in je hand hebt, en het hoeft het plan-scherm niet te verzetten om in het
logboek te komen — het veld bovenaan blijft de aflezing die de lopende sessie opnieuw verankert, dit
veld raakt de berekening niet aan.

De `kWh`-kolom blijft bestaan in `log.md`, in `logline.ts` en in `calibrate.mjs`: hij is het enige
wat rendement van capaciteit scheidt, en wie de stand van zijn meter wél opschrijft, zet hem met de
hand in de tabel. Wat de app niet meer doet is erom vragen zonder dat ze weet waar het getal
vandaan komt.

Wat er al bewaard stond, verhuist eenmalig mee: `withMeterAsPercent()` leest een kWh-waarde die de
lader er in die uren niet doorheen kán hebben geduwd (`maxMeterKwh()` in `src/core/charge.ts`, dus
de grens hangt aan de constanten en niet aan een vast getal) als aflezing, en zet hem in `eind%`.
Een echte meterstand blijft staan, en een getal dat geen van beide kan zijn ook — raden is hier
erger dan laten staan. De app zegt in een melding dát ze het gedaan heeft: cijfers in iemands
logboek verzetten mag, stilletjes doen niet. Die melding staat ónder de knoppen, om dezelfde reden
als de meldingsregel bij de rekenregels.

Bewust níét gedaan: de benodigde kWh alsnog op het scherm zetten (zie de vorige sectie — vier
uitkomstregels, en dat blijft) en de kolom uit het formaat slopen.

## Wat er niet op het scherm staat — 2026-09-11

De benodigde kWh en het verbruik uit de muur worden wel gerekend (`Estimate.energyKwh`,
`wallEnergyKwh`) maar niet getoond: het scherm heeft vier uitkomstregels en dat is het. Ze staan in
de agenda-afspraak, waar je ze later nog eens terug kunt lezen. Het huidige percentage staat ook
bewust **leeg** bij het openen — dat is elke keer anders, dus een voorgevuld getal is een gok die
op een meting lijkt. Het doelpercentage is wél een voorkeur en wordt onthouden.

## De PWA is de hele app, en Pages is het publicatiepad — 2026-09-11

De zusters hebben allemaal twee kanalen: een native Kotlin-APK en een webkopie, elk met hun eigen
distributie (een private `*-src` repo, artefacten in een publieke dist-repo). Hier niet, om twee
redenen:

- **Geen APK.** Deze app doet niets waarvoor Android zelf nodig is — geen sensoren, geen
  achtergrondwerk, geen store. Twee invoervelden en een rekensom zijn in de browser compleet, en de
  PWA staat na *Toevoegen aan startscherm* net zo op het startscherm als een APK. Een tweede
  codebase onderhouden voor hetzelfde antwoord is de prijs niet waard.
- **Geen dist-repo.** Deze repo is zelf publiek, dus de artefacten horen op zijn eigen GitHub Pages
  in plaats van in een gedeelde dist-repo. `.github/workflows/pages.yml` bouwt bij elke push naar
  `main`, met de tests ervóór, en publiceert `build/`. Daarmee is de installatielink
  <https://abons.github.io/e-charge/> ook de deploy — er is geen aparte go-live-stap meer, en dus
  ook geen onleesbare dist-diff om op provenance te vertrouwen.

De service-worker-versie wordt door `scripts/build.mjs` gestempeld en niet door een publish-script,
zodat een deploy zichzelf doorzet zonder dat iemand eraan moet denken.
