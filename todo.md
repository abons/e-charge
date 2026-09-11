# e-charge — openstaand werk

> **Alleen wat nog open is.** Het waarom staat in `design.md`, de regels in `CLAUDE.md`.

**Stand:** gebouwd en getest op 2026-09-11 (11/11 tests groen, bundel ~4 kB). In Chromium op een
telefoonformaat doorlopen: leeg scherm, 43 → 90%, "laden niet nodig", klemmen op 0–100, doel dat een
reload overleeft, `morgen` over middernacht, de `.ics`-download en offline na een reload. **Nog niet
op een echte telefoon gezien.**

## Hier begint de volgende sessie

- **Klopt de laadtijd in de praktijk?** De schatting rust op één meetbaar getal (`EFFICIENCY = 0,88`,
  binnen de 85–90% die voor een Leaf aan een stopcontact gemeten wordt). Eén echte sessie van bekend
  % naar bekend % is genoeg om het te kalibreren; wijkt het af, dan is dat die ene constante en niet
  het model. Het voorbeeld uit de opdracht (43 → 90% in 8u 35m) komt hier uit op 9u 04m — dat
  verschil is precies deze factor, en de praktijk beslist wie er dichterbij zit.
- **De agenda-download op een echte telefoon.** In Chromium komt het `.ics` goed binnen, maar of
  Android hem aan de agenda-app aanbiedt (en of de melding meekomt) is niet te zien in een headless
  browser.

## Openstaand

- ⚠️ **Pages moet één keer met de hand aangezet worden:** Settings → Pages → Source =
  "GitHub Actions". Tot dat gebeurt draait `.github/workflows/pages.yml` wel en publiceert hij
  niets, en is <https://abons.github.io/e-charge/> (de link in de README en op de pagina zelf) dood.
  De eerste run gebeurt bij de push naar `main`, dus dit is het eerste wat na de merge te checken is.
- **Het icoon is één SVG.** Goed genoeg voor de favicon en voor Chrome's installatie, maar een
  maskable launcher-icoon knipt een vol vierkant af; een echt PNG-paar (192/512) vraagt een oog op
  een toestel. Zelfde open punt als bij Word Guesser.
- **Winterverlies is niet gemodelleerd.** Bij vorst gaat een deel van het vermogen naar het
  verwarmen van het pakket, en dan duurt laden langer dan deze app zegt. Dat is eerlijk op te lossen
  met één extra factor, maar niet zonder een winter aan metingen — tot die tijd is `EFFICIENCY`
  bijdraaien de betere knop.
