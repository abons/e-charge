# e-charge — Leaf laadtijd (PWA)

Een rekenhulp van één scherm: hoe lang doet een **Nissan Leaf 2019 (40 kWh)** aan een **gewoon
230V-stopcontact** over van je huidige naar je gewenste batterijpercentage, en hoe laat is hij dan
klaar.

Zelfde bouw als de webkant van de andere projecten (`wordguesser-src/web/`): **plain TypeScript +
DOM, geen framework**, esbuild bundelt naar één `app.js`, en de verzonden pagina heeft **nul
runtime-dependencies**. Installeerbaar als app (PWA) en compleet offline — er is niets dat van een
netwerk moet komen.

Geen backend, geen login, geen cloud, geen Nissan- of OBD-koppeling. De app weet niets van de auto:
jij typt het percentage, de app rekent.

## Build / test

- `npm install` — alleen dev-dependencies (TypeScript + esbuild).
- `npm test` — type-check + de rekentests.
- `npm run build` — bundel + statische bestanden naar `build/`.
- `npm run serve` — lokale dev-server over `build/` met rebuild-on-change.

## De drie getallen die alles bepalen

Boven in [`src/core/charge.ts`](src/core/charge.ts), en nergens anders:

| constante              | waarde | waarom                                                   |
| ---------------------- | ------ | -------------------------------------------------------- |
| `USABLE_CAPACITY_KWH`  | 39,0   | Leaf ZE1 40 kWh: bruto 40, bruikbaar ~39                 |
| `CHARGE_POWER_KW`      | 2,3    | 10 A × 230 V uit een stopcontact                         |
| `EFFICIENCY`           | 0,88   | rendement muur → batterij bij zo'n traag laadvermogen     |

Kalibreren: laad één keer van bekend % naar bekend % en vergelijk met wat de app zei. Duurde het 10%
langer, dan gaat `EFFICIENCY` ~10% omlaag. Een andere auto of laadpunt is één regel: 62 kWh en
11 kW past er net zo goed in (daar is een test voor).

De aannames staan ook onderaan het scherm, gelezen uit dezelfde constanten — een uitkomst die
vreemd voelt, is zo te herleiden.

## Layout

- `src/core/` — de pure stukken, één bestand elk: `charge` (de rekenkern), `time` (klok, duur,
  "morgen"), `ics` (de agenda-afspraak).
- `src/main.ts` + `web/` — het enige scherm, de PWA-manifest en de service worker.
- `test/charge.test.ts` — de rekentests.
- `scripts/build.mjs` — bundel en dev-server.

Openstaand werk staat in `todo.md`, keuzes in `design.md`, regels voor een volgende sessie in
`CLAUDE.md`.
