/**
 * Een iCalendar-bestandje voor de eindtijd, met melding. Geen agenda-API, geen koppeling, geen
 * account: één `.ics` die je downloadt en die de agenda-app van de telefoon zelf openmaakt. Dat is
 * de enige vorm die zonder backend of login werkt, en daarmee de enige vorm die hier past.
 *
 * ⚠️ De afspraak staat *op* het klaar-moment (een kwartier lang), niet over de hele laadsessie
 * heen. Een melding aan het eind van een afspraak (`TRIGGER;RELATED=END`) wordt door Google
 * Calendar wisselend geïmporteerd; een melding op het begin (`TRIGGER:PT0S`) door iedereen. Het is
 * de eindtijd die je wilt weten, dus is de eindtijd de afspraak.
 */

/** `YYYYMMDDTHHMMSSZ` — UTC, want dan hoeft er geen VTIMEZONE-blok mee. */
function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 §3.3.11: `\`, `;`, `,` en regeleindes zijn in tekstvelden speciaal. */
function escapeText(value: string): string {
  return value.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: regels mogen niet langer zijn dan 75 *octetten*, en breken gaat met CRLF plus een
 * spatie. Onze regels zijn kort, maar `→` en `±` kosten meerdere bytes, dus tellen we bytes en
 * geen tekens — en nooit midden in een teken.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  let out = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out += "\r\n ";
      bytes = 1; // de leidende spatie telt mee
      limit = 75;
    }
    out += char;
    bytes += size;
  }
  return out;
}

export interface CalendarEvent {
  /** Het moment waarop de auto klaar is; de afspraak begint hier. */
  readyMs: number;
  title: string;
  description: string;
  /** Hoe lang de afspraak in de agenda staat. */
  minutes?: number;
}

/** Een compleet `.ics`-bestand met één afspraak en één melding. */
export function calendar(event: CalendarEvent, nowMs: number = Date.now()): string {
  const minutes = event.minutes ?? 15;
  const uid = `${stamp(event.readyMs)}-${Math.random().toString(36).slice(2, 10)}@e-charge`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//hrbons//e-charge//NL",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp(nowMs)}`,
    `DTSTART:${stamp(event.readyMs)}`,
    `DTEND:${stamp(event.readyMs + minutes * 60_000)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(event.title)}`,
    "TRIGGER:PT0S",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
