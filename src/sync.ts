import { shrinks, type Backup } from "./core/backup.js";
import { parseEntries } from "./core/logbook.js";
import { EMPTY_SHARED, fromFields, mergeShared, plateDocId, sharedEqual, toFields, type Shared } from "./core/sync.js";
import { FIREBASE } from "./sync-config.js";

/**
 * Sessie en logboek van een auto delen via Firestore (REST, zonder SDK en zonder inlog), met het
 * kenteken als enige sleutel. Dit is de derde plek in de app die een netwerk aanraakt, naast
 * `prices.ts` en `car.ts`, en net als die niet verplicht: zonder bereik, zonder kenteken of zonder
 * `sync-config.ts` blijft alles lokaal werken en haalt de volgende poging het in.
 *
 * Eén document per auto: `echarge/<sha256 van het kenteken>`. Elke ronde: lezen, samenvoegen met wat
 * lokaal staat (`core/sync.ts`), lokaal toepassen, en terugschrijven mét voorwaarde op `updateTime` —
 * schrijft de partner tussendoor, dan weigert de server en lezen we opnieuw. Zo gaat er niets verloren.
 */
export interface Host {
  /** Het kenteken van de actieve auto, of `null` (dan wordt er niets gedeeld). */
  plate(): string | null;
  read(): Shared;
  /** Past de samengevoegde stand lokaal toe zonder dat dat zelf weer een ronde aanvraagt. */
  apply(merged: Shared): void;
  /** Wanneer deze telefoon voor het laatst een geschiedenisregel schreef (ms); 0 = nooit. */
  historyAt?(): number;
  markHistory?(ms: number): void;
  /** De geschiedenis uit Firestore, om de lokale back-ups mee aan te vullen. */
  addBackups?(plate: string, backups: Backup[]): void;
}

/**
 * De id van een geschiedenisregel is een *omgekeerde* tijd: Firestore sorteert een lijst op naam oplopend,
 * en aflopend sorteren vraagt een index die in de console aangemaakt moet worden. Zo staat de nieuwste vooraan.
 */
const HISTORY_EPOCH = 1e15;
export const historyId = (ms: number): string => String(HISTORY_EPOCH - ms).padStart(16, "0");
const historyMs = (id: string): number => HISTORY_EPOCH - Number(id);

/** Een geschiedenisregel per etmaal, en altijd vlak voordat een samenvoeging een regel uit het document haalt. */
const HISTORY_EVERY_MS = 24 * 3_600_000;
const HISTORY_PAGE = 8;

export type FetchFn = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const TIMEOUT_MS = 8000;
const POLL_MS = 60_000;
const ATTEMPTS = 4;
const FIELD_PATHS = ["logbook", "gone", "session", "finished", "stateAt"];

export const delenAan = (): boolean => FIREBASE.projectId !== "" && FIREBASE.apiKey !== "";

let host: Host | null = null;
let busy = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let status = "";
let listener: (() => void) | null = null;

/** Wat de auto-dialoog zegt; leeg zolang delen uit staat of er geen kenteken is. */
export const syncStatus = (): string => status;

function zet(text: string): void {
  status = text;
  listener?.();
}

const klok = (): string => new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

/**
 * Eén ronde. Geeft `true` als alles gelijk staat, `false` bij een fout (de status zegt welke).
 * `fetchFn` is er voor de test.
 */
export async function syncOnce(h: Host, fetchFn: FetchFn = fetch as unknown as FetchFn, subtle?: SubtleCrypto): Promise<boolean> {
  const plate = h.plate();
  if (!delenAan() || plate === null) {
    zet("");
    return true;
  }
  try {
    const id = await plateDocId(plate, subtle);
    const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/echarge/${id}`;
    const key = `key=${encodeURIComponent(FIREBASE.apiKey)}`;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const got = await fetchFn(`${base}?${key}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      let remote: Shared | null = null;
      let updateTime = "";
      if (got.status === 404) {
        remote = null;
      } else if (!got.ok) {
        zet(got.status === 403 ? "Delen geweigerd (Firestore-regels of sleutel)." : `Delen mislukt (${got.status}).`);
        return false;
      } else {
        const doc = (await got.json()) as { fields?: unknown; updateTime?: unknown };
        remote = fromFields(doc.fields, parseEntries);
        updateTime = typeof doc.updateTime === "string" ? doc.updateTime : "";
      }
      // De auto kan tijdens het wachten gewisseld zijn: dan hoort dit antwoord niet meer bij het scherm.
      if (h.plate() !== plate) return false;
      const local = h.read();
      const merged = remote === null ? local : mergeShared(local, remote);
      if (!sharedEqual(merged, local)) h.apply(merged);
      if (remote !== null && sharedEqual(merged, remote)) {
        zet(`Gedeeld ✓ ${klok()}`);
        return true;
      }
      if (remote === null && sharedEqual(merged, EMPTY_SHARED)) {
        zet(`Gedeeld ✓ ${klok()}`);
        return true;
      }
      // Het vangnet: de oude stand van het document als aparte, onveranderlijke regel (de regels staan
      // alleen aanmaken toe, geen bijwerken of wissen). Mislukt dat, dan gaat het delen gewoon door.
      if (remote !== null && remote.logbook.length > 0) {
        const nu = Date.now();
        const laatste = h.historyAt?.() ?? 0;
        if (shrinks(remote.logbook, merged.logbook) || nu - laatste >= HISTORY_EVERY_MS) {
          const id = historyId(nu);
          try {
            const hist = await fetchFn(`${base}/history?${key}&documentId=${id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fields: toFields(remote) }),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (hist.ok) h.markHistory?.(nu);
          } catch {
            /* geen bereik: de schrijfpoging hieronder merkt dat ook */
          }
        }
      }
      const precondition = remote === null || updateTime === "" ? "currentDocument.exists=false" : `currentDocument.updateTime=${encodeURIComponent(updateTime)}`;
      const mask = FIELD_PATHS.map((p) => `updateMask.fieldPaths=${p}`).join("&");
      const put = await fetchFn(`${base}?${key}&${mask}&${precondition}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: toFields(merged) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (put.ok) {
        zet(`Gedeeld ✓ ${klok()}`);
        return true;
      }
      // De partner schreef tussen ons lezen en schrijven: opnieuw lezen en samenvoegen.
      if (put.status === 400 || put.status === 409 || put.status === 412) continue;
      zet(put.status === 403 ? "Delen geweigerd (Firestore-regels of sleutel)." : `Delen mislukt (${put.status}).`);
      return false;
    }
    zet("Delen mislukt (te druk, probeer later).");
    return false;
  } catch {
    zet("Delen mislukt (geen bereik?).");
    return false;
  }
}

/** De laatste geschiedenisregels van deze auto, oudste eerst; `null` bij een fout (dan later opnieuw proberen). */
export async function fetchHistory(plate: string, fetchFn: FetchFn = fetch as unknown as FetchFn, subtle?: SubtleCrypto): Promise<Backup[] | null> {
  if (!delenAan()) return null;
  try {
    const id = await plateDocId(plate, subtle);
    const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/echarge/${id}/history`;
    const got = await fetchFn(`${base}?key=${encodeURIComponent(FIREBASE.apiKey)}&pageSize=${HISTORY_PAGE}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!got.ok) return null;
    const body = (await got.json()) as { documents?: { name?: unknown; fields?: unknown }[] };
    const uit: Backup[] = [];
    for (const d of body.documents ?? []) {
      const at = historyMs(String(d.name ?? "").split("/").pop() ?? "");
      const logbook = fromFields(d.fields, parseEntries).logbook;
      if (Number.isFinite(at) && logbook.length > 0) uit.push({ at, logbook });
    }
    return uit.sort((a, b) => a.at - b.at);
  } catch {
    return null;
  }
}

/** Per kenteken één keer per sessie, en alleen als het ophalen lukte. */
const historyFetched = new Set<string>();

async function ronde(): Promise<void> {
  if (host === null) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    const ok = await syncOnce(host);
    // Eén keer per sessie de geschiedenis erbij halen: dan bieden de lokale back-ups ook wat de partner of een eerdere
    // telefoon weet ("Zet terug" onder het logboek).
    const plate = host.plate();
    if (ok && plate !== null && !historyFetched.has(plate) && host.addBackups !== undefined) {
      const geschiedenis = await fetchHistory(plate);
      if (geschiedenis !== null) {
        historyFetched.add(plate);
        host.addBackups(plate, geschiedenis);
      }
    }
  } finally {
    busy = false;
  }
  if (again) {
    again = false;
    requestSync();
  }
}

/** Binnenkort een ronde; meerdere aanvragen kort na elkaar worden één. */
export function requestSync(delayMs = 800): void {
  if (host === null || !delenAan()) return;
  clearTimeout(timer);
  timer = setTimeout(() => void ronde(), delayMs);
}

/** Start het delen: nu, bij terugkeer naar de app, na elke wijziging (`requestSync`) en elke minuut zolang de app open is. */
export function startSync(h: Host, onStatus: () => void): void {
  host = h;
  listener = onStatus;
  if (!delenAan()) return;
  requestSync(0);
  setInterval(() => {
    if (!document.hidden) requestSync(0);
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestSync(0);
  });
  window.addEventListener("online", () => requestSync(0));
}
