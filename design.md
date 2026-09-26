# e-charge — ontwerpkeuzes

> Eén keuze per notitie, zelfde opzet als de zusters. Kort, want deze app is klein en hoort klein
> te blijven.

## De app weet niets van de auto — 2026-09-11

Bij het ontstaan was dit expliciet: geen backend, geen login, geen cloud, geen Nissan API, geen OBD,
geen externe service. Dat is niet alleen een beperking maar het hele ontwerp: wat je overhoudt is
een rekenmachine met twee invoervelden, en die werkt offline, gaat nooit stuk door een API die
verandert, en heeft niets te onderhouden. Wie ooit "maar dan haalt hij het percentage zelf op" wil,
bouwt een andere app.

## De stroomprijs komt van het net, en dat is de enige uitzondering — 2026-09-25

De vraag was: *zijn de stroomkosten van Zonneplan publiek, zodat ik de laadkosten in de app kan
zien?* Het antwoord is ja en nee. De kwartierprijzen staan open op zonneplan.nl en in hun app, maar
een API is er niet — de Home Assistant-koppeling gebruikt de privé-API van de app, met inloggen, en
Zonneplan heeft die al eens dichtgezet. Wat wél publiek en stabiel is, is waar Zonneplan zijn prijs
van maakt: de EPEX day-ahead-prijs per kwartier, plus een inkoopvergoeding, plus energiebelasting,
plus btw. Die opbouw staat in `src/core/price.ts` als drie constanten, naast de vier autoconstanten
in `charge.ts`.

De eigenaar wilde dit ondanks de regel *de app weet niets van de auto* — en dat is ook geen
tegenspraak: de app weet nog steeds niets van de auto, ze weet nu iets van de markt. De grenzen die
blijven staan:

- **Eén bestand raakt het net aan** (`src/prices.ts`), met één bron zonder sleutel: de publieke
  prijzen-API van EnergyZero. De eerste versie had er twee (het oude EnergyZero-endpoint, dan
  Energy-Charts van Fraunhofer ISE) omdat CORS vanaf een bureau niet te zien was, en de telefoon
  zei prompt "geen prijzen": het oude endpoint kent geen kwartieren en Energy-Charts laat alleen
  zijn eigen origin toe. Een tijdelijke GitHub-workflow met `curl -H "Origin: …"` bracht dat boven
  en vond het endpoint dat de client python-energyzero ook gebruikt — mét de juiste
  `access-control-allow-origin`. Een bron die je niet vanuit een browser hebt zien antwoorden, is
  geen bron.
- **Zuinig en offline-bestendig.** Prijzen gaan naar `localStorage`; ophalen gebeurt alleen als de
  laadbeurt buiten de bekende kwartieren valt, en hooguit één keer per kwartier. Zonder bereik staat
  er wat er het laatst was, of "geen prijzen" — nooit een leeg scherm.
- **Elk kwartier tegen zijn eigen prijs**, met het vermogen uit de muur (dát staat op de rekening),
  over de héle laadbeurt vanaf het insteken. De prijzen van morgen komen rond 13:00; tot die tijd
  wordt het onbekende deel geschat op het gemiddelde van wat bekend is, en zegt de regel dat erbij.
- **Het is de eerste afgeleide euro op het scherm**, naast de vier uitkomstregels. Hij staat als
  vijfde regel onder Laadvermogen, is er altijd (ook als streepje), en verandert dus nooit iets van
  hoogte boven de knoppen. De agenda-afspraak krijgt hetzelfde bedrag mee.

Bewust níét: een sleutel of token in de bundel (publieke pagina), een eigen proxy, en iets anders
ophalen dan de prijs.

## Lineair rekenen, geen laadcurve — 2026-09-11

Een laadcurve hoort bij snelladen: daar knijpt de auto af zodra de cellen het vermogen niet meer
kwijtkunnen. Een paar kW zit daar zó ver onder dat de boordlader tot vlak onder 100% constant doorgaat.
Een curve zou hier dus doen alsof er meer bekend is dan waar is. De verliezen zitten in één
rendementsfactor (`EFFICIENCY`), en die is meetbaar met één laadsessie — een curve niet.

✅ Bevestigd op 2026-09-20: drie beurten die tot 97, 90 en 98% doorliepen gaven 9,79 / 10,29 / 10,11
procentpunt per uur. Was er een afknik, dan zou juist de beurt die tot 98% ging eruit springen.

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

## De capaciteit is gefit op drie laadbeurten — 2026-09-20

Het scherm meldde 90% terwijl het dashboard 98% zei. Drie beurten uit het logboek (13/17/20 sep:
74→97 in 2u21, 55→90 in 3u24, 54→98 in 4u21) geven samen 102 procentpunt in 10u06 — **10,1 %/uur**,
waar de app op 7,9 rekende. Ruim 30% mis, en niet één keer maar alle drie.

Wat de laadtijd bepaalt is één breuk: `powerKw × efficiency ÷ capacityKwh`. Die is nu gemeten. De
verdeling over de drie getallen is dat niet, en die volgt uit wat er wél afgelezen is:

- **Het vermogen staat op het blok van de kabel: 3,5 kW.** Dat is de enige directe aflezing die er
  is, dus die blijft staan en de rest moet eromheen.
- **Dan is de capaciteit 30,5 kWh** in plaats van de 39 van een nieuw pakket: 3,5 × 0,88 gedeeld
  door 10,1 %/uur. Dat is SoH ≈ 78%, negen à tien van de twaalf streepjes — voor een Leaf van 2019
  met 97.000 km en geen accukoeling niet vreemd. De tegenproef staat in hetzelfde logboek: 158 km
  tussen de beurten door kostte 78 procentpunt, en dat is bij 30,5 kWh 15,1 kWh/100 km over de hele
  afstand (`calibrate` middelt per rit en komt op 15,2). Bij 39 kWh zou het 19,3 zijn, wat voor
  september veel is.
- **Het rendement blijft 0,88 en ongemeten**, en ruilt één op één tegen de capaciteit: 0,93 zou
  32,2 kWh betekenen. Alleen de `kWh`-kolom — wat de huismeter over één beurt telde — splitst ze.

Voor de vraag die de app stelt maakt die laatste onzekerheid niets uit; voor `rangeKm()` wel, en daar
is een te lage capaciteit de veilige kant (te weinig km beloven kost niets). Een test pint de drie
beurten vast op vijf minuten nauwkeurig, zodat niemand later aan één constante draait zonder naar de
metingen te kijken.

## Het doel is geen plafond voor "Nu ongeveer" — 2026-09-20

`percentAfter()` klemde op het doelpercentage, met als reden "daar stopt de auto". Dat klopt niet:
de auto kent jouw doel niet — dat staat in een browser, niet in de Leaf. Wie na de geschatte eindtijd
blijft laden, laadt gewoon door. Het scherm bleef daardoor 90% melden terwijl er 98% in zat, en dat
las als een rekenfout terwijl het een plafond was. Het maakte bovendien elke aflezing boven het doel
waardeloos als kalibratie, want het verschil zat dan in de klem en niet in de constanten — precies
wat de aflezing van 2026-09-13 onbruikbaar maakte. Nu klimt de schatting door tot 100%, en noemt de
melding bij "Nog 0m" het gerekende percentage in plaats van het doel.

De omgekeerd-test blijft staan maar vergelijkt op hele procenten: `estimate()` rondt de minuten naar
boven, dus op het klaar-moment zit er hooguit 0,17 procentpunt overheen, en het scherm toont
`Math.floor(soc)`.

## Kilometers zijn een vierde constante — 2026-09-11

Bereik in km vraagt een verbruik, en dat is uit de andere drie niet af te leiden.
`CONSUMPTION_KWH_PER_100KM = 17,0` is gemengd Nederlands rijden voor een Leaf 40 kWh; in de zomer
eerder 15, met vorst ruim 20. Het logboek meet er sinds 2026-09-20 15,1 (zie hierboven) en toch
blijft hij op 17,0. Aan de hoge kant kiezen is hier de veiligere fout, om dezelfde reden
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
publieke code, en dat is een gelekt token. Het klembord is tekst, geen verbinding.

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
