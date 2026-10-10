import { withEntry, type Entry } from "./logbook.js";

/**
 * Sessie en logboek van één auto delen tussen twee telefoons. Puur: het netwerk zit in `src/sync.ts`.
 *
 * Wat gedeeld wordt is per auto (de sleutel is een hash van het kenteken): het logboek, de lopende
 * sessie en de laatst afgesloten beurt. Doel en laadstand zijn voorkeuren van de telefoon en blijven
 * waar ze zijn.
 *
 * ⚠️ **Samenvoegen moet bij beide telefoons op hetzelfde uitkomen**, anders blijven ze elkaar
 * bijwerken. Daarom is alles hier deterministisch en onafhankelijk van wie "lokaal" is:
 * - logboek: per `startMs` wint de regel met de hoogste `savedAt`; gelijke start = dezelfde beurt, en
 *   `withEntry` vult lege velden aan (de ene voegt km toe, de ander het bedrag);
 * - wissen: een wisbewijs (`gone[startMs]` = moment van wissen) verbergt een regel die ouder is. Een
 *   regel die daarna opnieuw bewaard wordt (zelfde starttijd handmatig) wint weer;
 * - sessie + laatst afgesloten: samen één momentopname, de nieuwste `at` wint. Niet per veld: ⏹ zet
 *   beide, en een mengsel van twee telefoons zou een lopende sessie naast een afgesloten beurt tonen.
 */
export interface Snapshot {
  /** Wanneer sessie/afgesloten voor het laatst lokaal veranderd zijn; 0 = nooit. */
  at: number;
  /** De opgeslagen JSON van de sessie, `null` = geen lopende. */
  session: string | null;
  finished: string | null;
}

export interface Shared {
  logbook: Entry[];
  /** startMs → moment van wissen. */
  gone: Record<string, number>;
  state: Snapshot;
}

export const EMPTY_SHARED: Shared = { logbook: [], gone: {}, state: { at: 0, session: null, finished: null } };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Alles van een regel behalve `savedAt`: wat telt als "veranderd". */
const inhoud = (e: Entry): string => JSON.stringify({ ...e, savedAt: 0 });

export function mergeLogbook(a: Entry[], b: Entry[], goneA: Record<string, number>, goneB: Record<string, number>): { logbook: Entry[]; gone: Record<string, number> } {
  const gone: Record<string, number> = { ...goneA };
  for (const [k, at] of Object.entries(goneB)) gone[k] = Math.max(gone[k] ?? 0, at);
  // Oudste eerst, zodat het nieuwste woord als laatste komt; bij gelijk moment wint de gemeten regel
  // en dan de latere afsluiting — beide kanten kiezen zo hetzelfde.
  const rank = (e: Entry): [number, number, number] => [e.savedAt ?? 0, e.estimated === true ? 0 : 1, e.endMs];
  const lijst = [...a, ...b].sort((x, y) => {
    const [x0, x1, x2] = rank(x);
    const [y0, y1, y2] = rank(y);
    return x0 - y0 || x1 - y1 || x2 - y2 || (inhoud(x) < inhoud(y) ? -1 : inhoud(x) > inhoud(y) ? 1 : 0);
  });
  let samen: Entry[] = [];
  for (const e of lijst) {
    const oud = samen.find((o) => o.startMs === e.startMs);
    // Identieke regel van de andere kant: niets te doen (en `withEntry` zou `savedAt` gelijk laten).
    if (oud !== undefined && same(oud, e)) continue;
    samen = withEntry(samen, e);
  }
  // ⚠️ Alleen een regel met een wisbewijs kan verborgen worden. Een regel van vóór het delen heeft
  // `savedAt` 0, en `0 > (gone ?? 0)` was onwaar: elke samenvoeging met een bestaand document wiste
  // zo het hele logboek van een telefoon die al beurten had.
  const zichtbaar = samen.filter((e) => {
    const weg = gone[String(e.startMs)];
    return weg === undefined || (e.savedAt ?? 0) > weg;
  });
  return { logbook: zichtbaar, gone };
}

export function mergeSnapshot(a: Snapshot, b: Snapshot): Snapshot {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  // Gelijk moment. ⚠️ Bij `at` 0 (een telefoon van vóór het delen, met een lopende sessie) wint wat er
  // íís boven wat er niet is: een lege telefoon die er voor het eerst bijkomt mag een lopende laadbeurt
  // niet wissen. Daarna een vaste keuze, zodat beide kanten hetzelfde kiezen.
  const inhoudVan = (s: Snapshot): number => (s.session !== null ? 2 : 0) + (s.finished !== null ? 1 : 0);
  if (inhoudVan(a) !== inhoudVan(b)) return inhoudVan(a) > inhoudVan(b) ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function mergeShared(a: Shared, b: Shared): Shared {
  const { logbook, gone } = mergeLogbook(a.logbook, b.logbook, a.gone, b.gone);
  return { logbook, gone, state: mergeSnapshot(a.state, b.state) };
}

export function sharedEqual(a: Shared, b: Shared): boolean {
  return same(a.logbook, b.logbook) && same(a.gone, b.gone) && same(a.state, b.state);
}

/**
 * Een lokale wijziging van het logboek: wat nieuw of veranderd is krijgt `savedAt = now`, wat weg is
 * een wisbewijs. Regels die ongewijzigd zijn houden hun oude `savedAt` — anders won elke telefoon
 * telkens van de ander.
 */
export function stampChanges(before: Entry[], after: Entry[], gone: Record<string, number>, now: number): { logbook: Entry[]; gone: Record<string, number> } {
  const oud = new Map(before.map((e) => [e.startMs, e]));
  const logbook = after.map((e) => {
    const was = oud.get(e.startMs);
    return was !== undefined && inhoud(was) === inhoud(e) ? { ...e, savedAt: was.savedAt ?? 0 } : { ...e, savedAt: now };
  });
  const nieuw = new Set(after.map((e) => e.startMs));
  const weg = { ...gone };
  for (const e of before) if (!nieuw.has(e.startMs)) weg[String(e.startMs)] = now;
  return { logbook, gone: weg };
}

/** Een parseerbare gone-tabel uit opslag of van het net; onzin valt weg. */
export function parseGone(raw: unknown): Record<string, number> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const uit: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "number" && Number.isFinite(v)) uit[k] = v;
  return uit;
}

/**
 * De sleutel van het gedeelde document: een hash van het kenteken, zodat het kenteken zelf niet als
 * leesbare tekst in de URL's naar de database staat. ⚠️ Dit is geen geheim: een kenteken is raadbaar en
 * wie het kent, kan het document lezen. Dat is de bedoeling ("alleen het kenteken"), en de reden dat
 * er niets staat dat je niet ook op `log.md` zou zetten.
 */
export async function plateDocId(plate: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const bytes = new TextEncoder().encode(`e-charge:${plate}`);
  const hash = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** De velden van het Firestore-document (REST-formaat); alles als tekst, zodat er niets te raden valt. */
export type Fields = Record<string, { stringValue: string }>;

export function toFields(s: Shared): Fields {
  return {
    logbook: { stringValue: JSON.stringify(s.logbook) },
    gone: { stringValue: JSON.stringify(s.gone) },
    session: { stringValue: s.state.session ?? "" },
    finished: { stringValue: s.state.finished ?? "" },
    stateAt: { stringValue: String(s.state.at) },
  };
}

/** Het document terug; ontbrekende of kapotte velden zijn leeg, nooit een fout. */
export function fromFields(fields: unknown, parseEntries: (raw: string | null) => Entry[]): Shared {
  const f = typeof fields === "object" && fields !== null ? (fields as Record<string, unknown>) : {};
  const text = (name: string): string => {
    const v = f[name];
    if (typeof v !== "object" || v === null) return "";
    const s = (v as Record<string, unknown>)["stringValue"];
    return typeof s === "string" ? s : "";
  };
  const at = Number(text("stateAt"));
  return {
    logbook: parseEntries(text("logbook") || null),
    gone: parseGone(text("gone")),
    state: { at: Number.isFinite(at) ? at : 0, session: text("session") || null, finished: text("finished") || null },
  };
}
