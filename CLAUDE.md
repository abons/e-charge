# e-charge — project summary (for a fresh session)

Een laadcalculator voor een **Nissan Leaf 2019 40 kWh aan een stopcontact van ~3 kW**: één scherm,
plain TypeScript + DOM, PWA. De webkant van de familie is het model (`wordguesser-src/web/` —
esbuild, `web/`-shell, `src/core/` met pure modules); dit is de kleinste telg. Zelfde doc-split als
de zusters: `README.md` (wat/hoe bouwen), dit bestand (regels), `design.md` (keuzes), `todo.md`
(alleen wat open is).

## Standing rules

- **De app weet niets van de auto, en dat blijft zo.** Geen backend, geen login, geen cloud, geen
  Nissan API, geen OBD, geen externe service — dat was de opdracht bij het ontstaan (2026-09-11) en
  het is ook de reden dat deze app offline werkt en niets te onderhouden heeft. Een feature die een
  netwerk nodig heeft, hoort hier niet.
- ⚠️ **Het logboek is een bestand, geen functie.** `log.md` wordt met de hand bijgehouden en
  `npm run calibrate` rekent de constanten eruit terug. De app schrijft er niet naar en praat met
  geen enkele server — een token in een publieke pagina is een gelekt token, en de vorige regel
  blijft gelden. Wie "de app logt zelf" wil bouwen, bouwt een andere app.
- ⚠️ **De vier constanten in `src/core/charge.ts` zijn de enige plek met auto- of laderkennis.**
  Reken nooit met een vast getal in `main.ts` of in de HTML; de regel onderaan het scherm en de
  agenda-tekst lezen dezelfde constanten, zodat scherm en rekenkern niet uit elkaar kunnen lopen.
- ⚠️ **Geen taper-model, en dat is een keuze, geen vergeten werk.** Bij een paar kW gaat de boordlader
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
- ⚠️ **Twee standen, en het verschil is één vraag: staat de stekker er al in?** Zonder lopende
  sessie is "Start" de klok van nu, en schuift de eindtijd dus mee met de tijd — juist zolang je nog
  niet ingestoken bent, fout zodra dat wel zo is. `⚡ Start laden` zet het moment vast in
  `localStorage`; vanaf dan telt de app af en loopt "Nu ongeveer" gerékend op. Een percentage dat je
  tijdens het laden intypt is een *aflezing van de auto* en verankert de sessie opnieuw vanaf nu —
  meteen de manier om `USABLE_CAPACITY_KWH` en `EFFICIENCY` te controleren.
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
