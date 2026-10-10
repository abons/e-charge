# e-charge — laadtijd aan het stopcontact (PWA)

Een rekenhulp van één scherm: hoe lang doet een **elektrische auto** aan een **gewoon
230V-stopcontact** over van je huidige naar je gewenste batterijpercentage, hoe laat hij dan klaar
is, en hoeveel kilometer daarin zit. Gebouwd voor een Nissan Leaf 2019 (40 kWh); sinds 2026-10-06 kun
je bovenin een andere auto kiezen (zie *Een auto kiezen*).

Het scherm heeft twee standen. Vóór het insteken plant hij: *als ik nú begin, hoe laat ben ik
klaar?* Druk je op **⚡ Start laden**, dan staat het startmoment vast, beweegt "Klaar rond" niet meer
en loopt het percentage gerékend op — een aftelling in plaats van een schatting vooraf.

Zelfde bouw als de webkant van de andere projecten (`wordguesser-src/web/`): **plain TypeScript +
DOM, geen framework**, esbuild bundelt naar één `app.js`, en de verzonden pagina heeft **nul
runtime-dependencies**. Installeerbaar als app (PWA) en offline bruikbaar: het enige dat van het net
komt is de stroomprijs per kwartier en, alleen als je op "Zoek" tikt, de naam van je auto bij RDW.
Zonder bereik rekent de app door met de laatst opgehaalde prijzen.

Geen backend, geen login, geen cloud, geen Nissan- of OBD-koppeling. De app weet niets van de auto
dat niet uit zijn eigen logboek komt, of — zolang dat logboek nog leeg is — een gemarkeerde schatting
uit zijn accugrootte: jij typt het percentage, de app rekent.

Sinds 2026-09-27 kent het scherm ook de **laadstand** van de kabel (8, 10, 13 of 16 A, de knop op
het Voldt-blok): kies de stand waar de knop op staat en laadtijd, eindtijd, kosten en logregel
rekenen met dat vermogen. De stand wordt onthouden als voorkeur, gaat mee in een lopende sessie, en
komt als `16 A` in de `opm`-kolom van het logboek.

Sinds 2026-09-25 staat er ook wat de laadbeurt **kost bij Zonneplan**: de EPEX-prijs per kwartier
(publiek, via de prijzen-API van EnergyZero) plus de opslag van Zonneplan en de energiebelasting,
met btw. Elk kwartier van de laadbeurt telt tegen zijn eigen prijs; de prijzen van morgen zijn er pas
rond 13:00, en tot die tijd zegt de regel "deels geschat". Daaronder staat wat een kilometer kost
bij die prijs, en het logboek bewaart de kosten van elke beurt in een `€`-kolom — `npm run
calibrate` rekent daar de gemeten kosten per km uit, over de kilometers tussen twee beurten.

Sinds 2026-10-08 zegt de regel **Goedkoopste start** wanneer dezelfde beurt het minst kost, en wat
dat scheelt met nu insteken. Een tik erop opent de kwartierprijzen als grafiek, met de beurt van nu
en die van het advies erin, en een keuze **Auto klaar vóór** (standaard: binnen een etmaal).

## Een auto kiezen

De regel bovenin is de auto (*Kies je auto* als er nog geen is). Tik erop voor een venster waarin je:

- **een kenteken** intikt en op *Zoek en bewaar* tikt: de app vraagt bij [RDW open data](https://opendata.rdw.nl)
  naar merk en model en kiest de bijpassende uitvoering uit de accutabel. Het kenteken blijft op je
  telefoon; alleen bij *Zoek* gaat het (in de URL) naar RDW. Het staat niet in een export of agenda-afspraak.
- **merk, model en uitvoering** kiest, zonder kenteken;
- **de bruikbare accu in kWh** invult als je auto er niet bij staat, of **zelf** een snelheid en bereik opgeeft;
- een bestaande auto **aanpast** ("Huidige auto aanpassen"), zonder zijn logboek kwijt te raken.

Logboek, lopende sessie en laatst afgesloten beurt zijn **per auto**; doel en laadstand zijn van de kabel
en blijven gelijk. Wisselen kan niet tijdens een lopende laadbeurt.

Een auto zonder logboek rekent met een **schatting uit zijn accu** (open-ev-data, MIT, meegebundeld in
[`src/core/evtable.ts`](src/core/evtable.ts), aangevuld met Dacia en Toyota met de hand in
[`src/core/evextra.ts`](src/core/evextra.ts)): snelheid = 3,5 kW × 85% ÷ accu × 100, bereik = accu ÷
verbruik. Gemeten tegen de Leaf van de eigenaar zat dat 23% te laag op de snelheid (veilige kant) en
16% te hoog op het bereik, en het scherm zegt dat ("±25%"). De schatting wordt vervangen door:

1. **een meting in de eerste beurt**: de eerste tussentijdse aflezing die minstens 30 minuten en 2
   procentpunt na de start ligt geeft de echte snelheid van die auto;
2. **je eigen logboek**, zodra er drie afgelezen beurten zijn.

Vernieuw de accutabel met `node scripts/ev-data.mjs`.

## Installeren

**<https://abons.github.io/e-charge/>** — open die pagina op je telefoon en kies *Toevoegen aan
startscherm*. Daarna start hij als eigen icoon en werkt hij zonder bereik; de service worker heeft
de hele app-shell in de cache.

Geen APK, anders dan bij de zusters: deze app doet niets waarvoor je Android zelf nodig hebt, dus is
de PWA de hele app. `.github/workflows/pages.yml` bouwt en publiceert bij elke push naar `main`.

## Delen met een partner

Optioneel. Zonder dit blijft alles op de telefoon. Zie `design.md` ("Delen met een partner") voor wat er
gedeeld wordt en waarom het kenteken de enige sleutel is.

1. Maak in de [Firebase-console](https://console.firebase.google.com/) een project, zet **Firestore** aan
   (productiemodus) en registreer een **webapp**.
2. Zet in `src/sync-config.ts` het `projectId` en de `apiKey` van die webapp. Beperk de sleutel in
   Google Cloud → API's en services → Inloggegevens tot HTTP-referrer `https://abons.github.io/*` en tot de
   Cloud Firestore API.
3. Firestore-regels:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /echarge/{id} {
      allow get: if id.matches('[0-9a-f]{64}');
      allow create, update: if id.matches('[0-9a-f]{64}')
        && request.resource.data.keys().hasOnly(['logbook', 'gone', 'session', 'finished', 'stateAt']);
      // De geschiedenis: alleen aanmaken en lezen, nooit bijwerken of wissen.
      match /history/{h} {
        allow get, list: if id.matches('[0-9a-f]{64}');
        allow create: if id.matches('[0-9a-f]{64}')
          && request.resource.data.keys().hasOnly(['logbook', 'gone', 'session', 'finished', 'stateAt']);
      }
    }
  }
}
```

4. Zet bij beide telefoons hetzelfde kenteken bij de auto ("Huidige auto aanpassen" of nieuwe auto). Onder
   in de autodialoog staat wanneer het delen voor het laatst lukte.

## Build / test

- `npm install` — alleen dev-dependencies (TypeScript + esbuild).
- `npm test` — type-check + de rekentests.
- `npm run build` — bundel + statische bestanden naar `build/`.
- `npm run serve` — lokale dev-server over `build/` met rebuild-on-change.
- `npm run calibrate` — leest `log.md` en rekent de constanten terug uit echte laadbeurten.
- `npm run kosten` — vult de lege `€`-cellen in `log.md` met de kwartierprijzen van die dag (netwerk).
- `node scripts/ev-data.mjs` — ververst `src/core/evtable.ts` uit open-ev-data (netwerk).

Onderaan het scherm staat het logboek: optionele velden voor km-stand en het afgelezen percentage,
een knop die de laadbeurt bewaart, en de lijst van wat je bewaard hebt. Eén knop zet het hele logboek op je
klembord; plakken in [`log.md`](log.md) en `npm run calibrate` doet de rest. ⚠️ De lijst in de app
staat op één telefoon en verdwijnt met het wissen van websitegegevens — het bestand in de repo is de
kopie die blijft.

## Geen aannames: alleen het logboek

Sinds 2026-10-06 rekent de app niet meer met geschatte autogegevens. Capaciteit, rendement en
verbruik zijn weg; wat overblijft komt uit [`log.md`](log.md) en de laadbeurten die de app zelf
bewaart. Alleen een auto die nog **geen** logboek heeft, krijgt een als zodanig gemarkeerde schatting
(*Een auto kiezen*).

| grootheid | komt uit | startwaarde zolang er te weinig beurten zijn |
| --- | --- | --- |
| laadsnelheid (procentpunt per uur) | mediaan van de laatste 8 afgelezen beurten, per laadstand | de Leaf: 10,1 op 16 A (`START_RATE_PP_PER_H`); een andere auto: je eigen invoer, een schatting uit zijn accu, of onbekend |
| kilometers per procentpunt | opeenvolgende regels: km-verschil ÷ procentpunten verbruikt | de Leaf: 2,0 (`START_KM_PER_PP`); een andere auto: idem |
| kosten per kilometer | prijs per kWh × (kW uit de muur ÷ snelheid) ÷ km per procentpunt | volgt uit bovenstaande |

De Leaf-startwaarden zijn afgeleid uit het logboek van die ene auto en gelden dus alleen voor hem
(`LEAF_START` in `derive.ts`); een andere auto erft ze nooit. Is de snelheid van een auto onbekend, dan
verzint het scherm er geen: het zegt dat hij onbekend is.

Boven in [`src/core/derive.ts`](src/core/derive.ts) staat de afleiding, en daar de drempels (3 beurten
op 16 A, 2 op een lagere stand, 3 geldige paren). Het enige getal dat nog in
[`src/core/charge.ts`](src/core/charge.ts) staat is wat van de kabel zelf is afgelezen:
`CHARGE_POWER_KW = 3,5` (voor kWh en kosten) en de standen `CHARGE_CURRENTS_A = [8, 10, 13, 16]` met
`RATED_CURRENT_A = 16`. Een lagere stand schaalt de snelheid lineair mee (8 A is de helft) zolang je er
nog niet vaak genoeg op hebt geladen, en het scherm zegt dat ("geschat uit 16 A").

Een beurt telt alleen mee als zijn `eind%` is **afgelezen** van het dashboard: ⏹ of 💾 zonder aflezing
bewaart de regel nog wel, met `geschat` in `opm`, maar zo'n regel voedt de snelheid en het bereik niet
(anders bevestigt de app zijn eigen schatting). Beurten die op 99–100% eindigen tellen niet voor de
snelheid, want de lader was eerder klaar dan je afkoppelde.

Noteer per laadbeurt de kilometerstand, de percentages en de klok in `log.md` (de app doet dat met 💾),
en `npm run calibrate` toont wat de app daaruit afleidt, welke regels niet meetellen en waarom, en of
de startwaarden nog kloppen — een test laat de build falen als ze uit elkaar lopen. Een andere auto of
laadpunt is dus geen constante meer aanpassen, maar een paar beurten loggen.

De bron van de getallen staat achter de **ⓘ** naast "Geschatte laadtijd" ("uit je logboek", "startwaarde
uit log.md", "schatting uit accugrootte van de …" of "gemeten in de eerste beurt"), zodat een uitkomst
die vreemd voelt te herleiden is.

## Layout

- `src/core/` — de pure stukken, één bestand elk: `charge` (de rekenkern), `derive` (wat het
  logboek zegt: laadsnelheid en km per procentpunt), `logmd` (leest `log.md`, alleen voor scripts en
  tests), `time` (klok, duur, "morgen"), `ics` (de agenda-afspraak), `price` (de tariefopbouw en de
  kostensom per kwartier), `advice` (het goedkoopste startmoment), `chart` (de prijsgrafiek als
  SVG), `car` (kenteken, RDW-antwoord, de lijst auto's en hun opslagsleutels),
  `evest` (de schatting uit accugrootte en het koppelen van een RDW-antwoord aan een uitvoering),
  `evtable` (gegenereerd uit open-ev-data) en `evextra` (Dacia en Toyota, met de hand).
- `src/prices.ts` — het ophalen en bewaren van de kwartierprijzen; netwerkplek 1.
- `src/car.ts` — het opzoeken van een kenteken bij RDW; netwerkplek 2, alleen op "Zoek".
- `src/main.ts` + `web/` — het enige scherm, de PWA-manifest en de service worker.
- `test/charge.test.ts`, `test/price.test.ts`, `test/car.test.ts`, `test/advice.test.ts` — de tests.
- `scripts/build.mjs` — bundel en dev-server; `scripts/ev-data.mjs` — ververst de accutabel.

Openstaand werk staat in `todo.md`, keuzes in `design.md`, regels voor een volgende sessie in
`CLAUDE.md`.
