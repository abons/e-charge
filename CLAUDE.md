# e-charge — project summary (for a fresh session)

Een laadcalculator voor een **Nissan Leaf 2019 40 kWh aan een 2,3 kW stopcontact**: één scherm,
plain TypeScript + DOM, PWA. De webkant van de familie is het model (`wordguesser-src/web/` —
esbuild, `web/`-shell, `src/core/` met pure modules); dit is de kleinste telg. Zelfde doc-split als
de zusters: `README.md` (wat/hoe bouwen), dit bestand (regels), `design.md` (keuzes), `todo.md`
(alleen wat open is).

## Standing rules

- **De app weet niets van de auto, en dat blijft zo.** Geen backend, geen login, geen cloud, geen
  Nissan API, geen OBD, geen externe service — dat was de opdracht bij het ontstaan (2026-09-11) en
  het is ook de reden dat deze app offline werkt en niets te onderhouden heeft. Een feature die een
  netwerk nodig heeft, hoort hier niet.
- ⚠️ **De drie constanten in `src/core/charge.ts` zijn de enige plek met auto- of laderkennis.**
  Reken nooit met een vast getal in `main.ts` of in de HTML; de regel onderaan het scherm en de
  agenda-tekst lezen dezelfde constanten, zodat scherm en rekenkern niet uit elkaar kunnen lopen.
- ⚠️ **Geen taper-model, en dat is een keuze, geen vergeten werk.** Bij 2,3 kW gaat de boordlader
  tot vlak onder 100% gewoon door; lineair is hier eerlijker dan een afknik-curve die doet alsof er
  meer bekend is. Zou de app ooit snelladen erbij krijgen, dan is dát het moment voor een curve —
  zie `design.md`.
- ⚠️ **`estimate()` rondt minuten naar boven.** Een halve minuut te weinig laden is een verkeerd
  antwoord; "±" staat er niet voor niets bij het vermogen.
- **Lokale tijd is hier de juiste tijd** — anders dan bij de zusters, waar UTC een contract tussen
  apparaten is. Dit is een stekker in één huis: de keukenklok telt. `src/core/time.ts` gebruikt dus
  bewust de `getHours()`-familie en geen UTC.
- **De UI is Nederlands** (zie `design.md`), anders dan Word Guesser — daar was Engels een
  familiebesluit over een spel in zestien talen; dit is één gereedschap voor één garage.
- ⚠️ **`render()` raakt de invoervelden niet aan.** De opmaak staat in `web/index.html`, JS schrijft
  alleen tekst in de plekken die veranderen. De schermklok tikt door (elke 15 s, en op
  `visibilitychange`), en een render die de invoer opnieuw opbouwt gooit je cursor uit het veld dat
  je aan het typen bent. Alleen `change` (bij het verlaten van een veld) mag een waarde normaliseren.
- ⚠️ **`sw.js`'s VERSION staat op `v1` en wordt door niets gestempeld.** Zolang dat zo is, is de
  cache-key onveranderlijk en blijft een tab die de app ooit laadde zijn eerste `app.js` houden —
  ook na een rebuild. Bij lokaal testen dus eerst de worker weggooien
  (`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()` plus
  `for (const k of await caches.keys()) await caches.delete(k)`) voordat je gelooft dat code stuk
  is. Dit heeft bij Word Guesser uren gekost; zie zijn `CLAUDE.md`.

## Build / run

`npm install` één keer, dan `npm test` (type-check + rekentests), `npm run build` (→ `build/`),
`npm run serve` (lokaal). Er is nog geen publicatiepad — `todo.md` zegt wat daarvoor moet.
