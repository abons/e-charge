# e-charge — Leaf laadtijd (PWA)

Een rekenhulp van één scherm: hoe lang doet een **Nissan Leaf 2019 (40 kWh)** aan een **gewoon
230V-stopcontact** over van je huidige naar je gewenste batterijpercentage, hoe laat hij dan klaar
is, en hoeveel kilometer daarin zit.

Het scherm heeft twee standen. Vóór het insteken plant hij: *als ik nú begin, hoe laat ben ik
klaar?* Druk je op **⚡ Start laden**, dan staat het startmoment vast, beweegt "Klaar rond" niet meer
en loopt het percentage gerékend op — een aftelling in plaats van een schatting vooraf.

Zelfde bouw als de webkant van de andere projecten (`wordguesser-src/web/`): **plain TypeScript +
DOM, geen framework**, esbuild bundelt naar één `app.js`, en de verzonden pagina heeft **nul
runtime-dependencies**. Installeerbaar als app (PWA) en offline bruikbaar: het enige dat van het net
komt is de stroomprijs per kwartier, en zonder bereik rekent de app door met de laatst opgehaalde.

Geen backend, geen login, geen cloud, geen Nissan- of OBD-koppeling. De app weet niets van de auto:
jij typt het percentage, de app rekent.

Sinds 2026-09-25 staat er ook wat de laadbeurt **kost bij Zonneplan**: de EPEX-prijs per kwartier
(publiek, via EnergyZero of Energy-Charts) plus de opslag van Zonneplan en de energiebelasting, met
btw. Elk kwartier van de laadbeurt telt tegen zijn eigen prijs; de prijzen van morgen zijn er pas
rond 13:00, en tot die tijd zegt de regel "deels geschat".

## Installeren

**<https://abons.github.io/e-charge/>** — open die pagina op je telefoon en kies *Toevoegen aan
startscherm*. Daarna start hij als eigen icoon en werkt hij zonder bereik; de service worker heeft
de hele app-shell in de cache.

Geen APK, anders dan bij de zusters: deze app doet niets waarvoor je Android zelf nodig hebt, dus is
de PWA de hele app. `.github/workflows/pages.yml` bouwt en publiceert bij elke push naar `main`.

## Build / test

- `npm install` — alleen dev-dependencies (TypeScript + esbuild).
- `npm test` — type-check + de rekentests.
- `npm run build` — bundel + statische bestanden naar `build/`.
- `npm run serve` — lokale dev-server over `build/` met rebuild-on-change.
- `npm run calibrate` — leest `log.md` en rekent de constanten terug uit echte laadbeurten.

Onderaan het scherm staat het logboek: optionele velden voor km-stand en het afgelezen percentage,
een knop die de laadbeurt bewaart, en de lijst van wat je bewaard hebt. Eén knop zet het hele logboek op je
klembord; plakken in [`log.md`](log.md) en `npm run calibrate` doet de rest. ⚠️ De lijst in de app
staat op één telefoon en verdwijnt met het wissen van websitegegevens — het bestand in de repo is de
kopie die blijft.

## De vier getallen die alles bepalen

Boven in [`src/core/charge.ts`](src/core/charge.ts), en nergens anders:

| constante              | waarde | waarom                                                   |
| ---------------------- | ------ | -------------------------------------------------------- |
| `USABLE_CAPACITY_KWH`  | 30,5   | teruggerekend uit drie laadbeurten; SoH ≈ 78% van de 39 nieuw |
| `CHARGE_POWER_KW`      | 3,5    | ~15 A × 230 V, afgelezen op de laadkabel                 |
| `EFFICIENCY`           | 0,88   | rendement muur → batterij bij zo'n traag laadvermogen     |
| `CONSUMPTION_KWH_PER_100KM` | 17,0 | verbruik, voor het omrekenen van % naar km             |

De capaciteit stond tot 2026-09-20 op 39,0, de waarde van een nieuw pakket, en de app was daardoor
ruim 30% te pessimistisch: drie gemeten laadbeurten laten 10,1 procentpunt per uur zien waar de app
7,9 rekende. Wat gemeten is, is de verhouding `powerKw × efficiency ÷ capacityKwh`; de verdeling
daarover leunt op het rendement en vraagt nog één meterstand. Zie [`design.md`](design.md).

Kalibreren gaat via [`log.md`](log.md): noteer per laadbeurt de kilometerstand, de percentages en de
klok, en `npm run calibrate` rekent er laadvermogen en verbruik uit terug. De `kWh`-kolom van je
meter vult de app niet — die is met de hand bij te schrijven en scheidt dan rendement van
capaciteit. Het verbruik komt daarmee uit gereden kilometers en niet uit de boordcomputer —
die toont een voorspelling, geen meting. Een andere auto of laadpunt is één regel: 62 kWh en
11 kW past er net zo goed in (daar is een test voor).

De aannames staan ook onderaan het scherm, gelezen uit dezelfde constanten — een uitkomst die
vreemd voelt, is zo te herleiden.

## Layout

- `src/core/` — de pure stukken, één bestand elk: `charge` (de rekenkern), `time` (klok, duur,
  "morgen"), `ics` (de agenda-afspraak), `price` (de tariefopbouw en de kostensom per kwartier).
- `src/prices.ts` — het ophalen en bewaren van de kwartierprijzen; de enige plek met netwerk.
- `src/main.ts` + `web/` — het enige scherm, de PWA-manifest en de service worker.
- `test/charge.test.ts`, `test/price.test.ts` — de rekentests.
- `scripts/build.mjs` — bundel en dev-server.

Openstaand werk staat in `todo.md`, keuzes in `design.md`, regels voor een volgende sessie in
`CLAUDE.md`.
