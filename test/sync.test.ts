import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEntries, type Entry } from "../src/core/logbook.js";
import { EMPTY_SHARED, fromFields, mergeLogbook, mergeShared, mergeSnapshot, plateDocId, stampChanges, toFields, type Shared } from "../src/core/sync.js";
import { fetchHistory, syncOnce, syncStatus, type FetchFn, type Host } from "../src/sync.js";
import { FIREBASE } from "../src/sync-config.js";

const entry = (startMs: number, extra: Partial<Entry> = {}): Entry => ({
  startMs,
  endMs: startMs + 6 * 3_600_000,
  fromPercent: 40,
  toPercent: 80,
  km: null,
  kwh: null,
  eur: null,
  amps: 16,
  estimated: false,
  savedAt: 0,
  ...extra,
});

const met = async (fn: () => Promise<void>): Promise<void> => {
  FIREBASE.projectId = "p";
  FIREBASE.apiKey = "k";
  try {
    await fn();
  } finally {
    FIREBASE.projectId = "";
    FIREBASE.apiKey = "";
  }
};

test("mergeLogbook: de ene telefoon voegt km toe, de andere het bedrag: beide blijven", () => {
  const a = [entry(1000, { km: 5000, savedAt: 10 })];
  const b = [entry(1000, { eur: 1.5, savedAt: 20 })];
  const { logbook } = mergeLogbook(a, b, {}, {});
  assert.equal(logbook.length, 1);
  assert.equal(logbook[0]!.km, 5000);
  assert.equal(logbook[0]!.eur, 1.5);
});

test("mergeLogbook: dezelfde uitkomst in beide richtingen", () => {
  const a = [entry(1000, { km: 5000, savedAt: 10 }), entry(5000, { savedAt: 3 })];
  const b = [entry(1000, { toPercent: 85, savedAt: 20 }), entry(9000, { savedAt: 4 })];
  assert.deepEqual(mergeLogbook(a, b, {}, {}), mergeLogbook(b, a, {}, {}));
});

test("mergeLogbook: een gewiste regel komt niet terug, een opnieuw bewaarde wel", () => {
  const oud = entry(1000, { savedAt: 10 });
  assert.equal(mergeLogbook([], [oud], { "1000": 50 }, {}).logbook.length, 0);
  const opnieuw = entry(1000, { toPercent: 90, savedAt: 60 });
  assert.equal(mergeLogbook([opnieuw], [oud], { "1000": 50 }, {}).logbook[0]!.toPercent, 90);
});

test("stampChanges: ongewijzigd houdt savedAt, nieuw en gewijzigd krijgen nu, weg wordt een wisbewijs", () => {
  const before = [entry(1, { savedAt: 5 }), entry(2, { savedAt: 6 }), entry(3, { savedAt: 7 })];
  const after = [entry(1, { savedAt: 5 }), entry(2, { km: 10, savedAt: 6 }), entry(4)];
  const r = stampChanges(before, after, {}, 100);
  assert.deepEqual(r.logbook.map((e) => e.savedAt), [5, 100, 100]);
  assert.deepEqual(r.gone, { "3": 100 });
});

test("mergeSnapshot: de nieuwste wint, gelijk is vast", () => {
  const a = { at: 5, session: "a", finished: null };
  const b = { at: 9, session: null, finished: "f" };
  assert.deepEqual(mergeSnapshot(a, b), b);
  assert.deepEqual(mergeSnapshot(b, a), b);
  const c = { at: 9, session: "x", finished: null };
  assert.deepEqual(mergeSnapshot(b, c), mergeSnapshot(c, b));
});

test("velden: rond en kapotte velden zijn leeg", () => {
  const s: Shared = { logbook: [entry(1000, { savedAt: 3 })], gone: { "5": 9 }, state: { at: 7, session: '{"a":1}', finished: null } };
  assert.deepEqual(fromFields(toFields(s), parseEntries), s);
  assert.deepEqual(fromFields(undefined, parseEntries), EMPTY_SHARED);
});

test("plateDocId: vast, 64 hex, en niet het kenteken zelf", async () => {
  const id = await plateDocId("AB123C");
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(id, await plateDocId("AB123C"));
  assert.notEqual(id, await plateDocId("AB123D"));
});

/** Een nagebootste Firestore met updateTime-voorwaarde; `tussendoor` laat de partner bij de eerste schrijfpoging eerst schrijven. */
function fakeFirestore(tussendoor?: () => Promise<void>) {
  let doc: { fields: unknown; updateTime: string } | null = null;
  let version = 0;
  let pogingen = 0;
  const history: { id: string; fields: unknown }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/history")) {
      if (init?.method === "POST") {
        history.push({ id: u.searchParams.get("documentId") ?? "", fields: (JSON.parse(init.body ?? "{}") as { fields: unknown }).fields });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      const documents = [...history].sort((a, b) => b.id.localeCompare(a.id)).map((d) => ({ name: `x/history/${d.id}`, fields: d.fields }));
      return { ok: true, status: 200, json: async () => ({ documents }) };
    }
    if (init?.method !== "PATCH") {
      return doc === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => structuredClone(doc) };
    }
    pogingen++;
    if (pogingen === 1) await tussendoor?.();
    const wantTime = u.searchParams.get("currentDocument.updateTime");
    const wantNew = u.searchParams.get("currentDocument.exists") === "false";
    if ((wantNew && doc !== null) || (wantTime !== null && (doc === null || doc.updateTime !== wantTime))) {
      return { ok: false, status: 400, json: async () => ({}) };
    }
    doc = { fields: (JSON.parse(init.body ?? "{}") as { fields: unknown }).fields, updateTime: `t${++version}` };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { fetchFn, history };
}

function telefoon(plate: string | null, start: Shared = EMPTY_SHARED) {
  let now: Shared = start;
  const host: Host = { plate: () => plate, read: () => now, apply: (m) => (now = m) };
  return { host, get: () => now };
}

const stand = (logbook: Entry[], at: number, session: string | null = null): Shared => ({ logbook, gone: {}, state: { at, session, finished: null } });

test("syncOnce: twee telefoons komen op hetzelfde uit", () =>
  met(async () => {
    const store = fakeFirestore();
    const a = telefoon("AB123C", stand([entry(1000, { savedAt: 10 })], 5));
    const b = telefoon("AB123C", stand([entry(2000, { savedAt: 20 })], 30, '{"s":2}'));
    assert.equal(await syncOnce(a.host, store.fetchFn), true);
    assert.equal(await syncOnce(b.host, store.fetchFn), true);
    assert.equal(await syncOnce(a.host, store.fetchFn), true);
    assert.deepEqual(a.get(), b.get());
    assert.equal(a.get().logbook.length, 2);
    assert.equal(a.get().state.session, '{"s":2}');
    assert.match(syncStatus(), /Gedeeld/);
  }));

test("syncOnce: schrijft de partner tussen lezen en schrijven, dan leest hij opnieuw en gaat er niets verloren", () =>
  met(async () => {
    const c = telefoon("AB123C", stand([entry(3000, { savedAt: 40 })], 0));
    const d = telefoon("AB123C", stand([entry(4000, { savedAt: 41 })], 0));
    const store: ReturnType<typeof fakeFirestore> = fakeFirestore(async () => void (await syncOnce(d.host, store.fetchFn)));
    // c leest (404), d schrijft eerst het document, c's schrijfpoging met `exists=false` wordt geweigerd en c begint opnieuw.
    assert.equal(await syncOnce(c.host, store.fetchFn), true);
    assert.equal(await syncOnce(d.host, store.fetchFn), true);
    assert.deepEqual(c.get().logbook.map((e) => e.startMs), [3000, 4000]);
    assert.deepEqual(c.get(), d.get());
  }));

test("syncOnce: zonder kenteken of zonder config gebeurt er niets", async () => {
  let calls = 0;
  const fetchFn: FetchFn = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  assert.equal(await syncOnce(telefoon("AB123C").host, fetchFn), true);
  await met(async () => {
    assert.equal(await syncOnce(telefoon(null).host, fetchFn), true);
  });
  assert.equal(calls, 0);
});

test("syncOnce: geen bereik en een geweigerde schrijfactie zeggen het", () =>
  met(async () => {
    const t = telefoon("AB123C", stand([entry(1)], 0));
    assert.equal(await syncOnce(t.host, async () => { throw new Error("offline"); }), false);
    assert.match(syncStatus(), /geen bereik/);
    const nee: FetchFn = async () => ({ ok: false, status: 403, json: async () => ({}) });
    assert.equal(await syncOnce(t.host, nee), false);
    assert.match(syncStatus(), /geweigerd/);
  }));

test("mergeShared: gelijk met gelijk verandert niets", () => {
  const s = stand([entry(1, { savedAt: 2 })], 4);
  assert.deepEqual(mergeShared(s, s), s);
});

test("mergeSnapshot: een lege telefoon die er nieuw bijkomt wist een lopende sessie niet (beide at 0)", () => {
  const lopend = { at: 0, session: '{"startMs":1}', finished: null };
  const leeg = { at: 0, session: null, finished: null };
  assert.deepEqual(mergeSnapshot(lopend, leeg), lopend);
  assert.deepEqual(mergeSnapshot(leeg, lopend), lopend);
});

test("mergeLogbook: regels van vóór het delen (savedAt 0) blijven staan zonder wisbewijs", () => {
  const oud = [entry(1000), entry(2000)];
  assert.equal(mergeLogbook(oud, [], {}, {}).logbook.length, 2);
  assert.equal(mergeLogbook([], oud, {}, {}).logbook.length, 2);
  // Mét wisbewijs blijft een ongestempelde regel weg.
  assert.equal(mergeLogbook(oud, [], { "1000": 5 }, {}).logbook.length, 1);
});

test("syncOnce: een telefoon met oude beurten verliest ze niet als er al een leeg document staat", () =>
  met(async () => {
    const store = fakeFirestore();
    const leeg = telefoon("AB123C", stand([], 0));
    const vol = telefoon("AB123C", stand([entry(1000), entry(2000)], 0));
    await syncOnce(leeg.host, store.fetchFn);
    await syncOnce(vol.host, store.fetchFn);
    assert.equal(vol.get().logbook.length, 2);
    await syncOnce(leeg.host, store.fetchFn);
    assert.equal(leeg.get().logbook.length, 2);
  }));

import { dailyDue, parseBackups, restorable, restoreMissing, shrinks, withBackup, MAX_BACKUPS } from "../src/core/backup.js";

test("backup: een opname voor een regel verdwijnt, niet bij toevoegen of leeg", () => {
  const a = [entry(1), entry(2)];
  assert.equal(shrinks(a, [entry(1)]), true);
  assert.equal(shrinks(a, [...a, entry(3)]), false);
  assert.deepEqual(withBackup([], [], 5), []);
  const een = withBackup([], a, 5);
  assert.equal(een.length, 1);
  assert.equal(withBackup(een, a, 9).length, 1, "gelijk aan de nieuwste: geen dubbele");
  let veel = een;
  for (let i = 0; i < 20; i++) veel = withBackup(veel, [entry(100 + i)], 10 + i);
  assert.equal(veel.length, MAX_BACKUPS);
});

test("backup: terugzetten voegt toe wat ontbreekt en laat de rest staan", () => {
  const opname = withBackup([], [entry(1, { km: 5 }), entry(2), entry(3)], 5);
  const nu = [entry(2, { km: 99 })];
  const kans = restorable(opname, nu)!;
  assert.deepEqual(kans.missing.map((e) => e.startMs), [1, 3]);
  const terug = restoreMissing(nu, kans.missing);
  assert.deepEqual(terug.map((e) => e.startMs), [1, 2, 3]);
  assert.equal(terug.find((e) => e.startMs === 2)!.km, 99);
  assert.equal(restorable(opname, terug), null);
});

test("backup: dagelijks en parseren", () => {
  assert.equal(dailyDue([], 1), true);
  const o = withBackup([], [entry(1)], 1000);
  assert.equal(dailyDue(o, 1000 + 3_600_000), false);
  assert.equal(dailyDue(o, 1000 + 25 * 3_600_000), true);
  assert.deepEqual(parseBackups(JSON.stringify(o)).map((b) => b.logbook.length), [1]);
  assert.deepEqual(parseBackups("onzin"), []);
});

test("geschiedenis: een samenvoeging die een regel uit het document haalt schrijft eerst de oude stand weg", () =>
  met(async () => {
    const store = fakeFirestore();
    const a = telefoon("AB123C", stand([entry(1000, { savedAt: 5 }), entry(2000, { savedAt: 5 })], 0));
    await syncOnce(a.host, store.fetchFn);
    assert.equal(store.history.length, 0, "eerste schrijf: nog niets te bewaren");
    // De partner wist beurt 1000 (wisbewijs) en synchroniseert.
    const b = telefoon("AB123C", { logbook: [entry(2000, { savedAt: 5 })], gone: { "1000": 99 }, state: { at: 0, session: null, finished: null } });
    let bewaard = 0;
    await syncOnce({ ...b.host, markHistory: (ms) => (bewaard = ms) }, store.fetchFn);
    assert.equal(store.history.length, 1);
    assert.ok(bewaard > 0);
    const oud = await fetchHistory("AB123C", store.fetchFn);
    assert.equal(oud.length, 1);
    assert.deepEqual(oud[0]!.logbook.map((e) => e.startMs), [1000, 2000]);
  }));

test("geschiedenis: hooguit één per etmaal als er niets verdwijnt", () =>
  met(async () => {
    const store = fakeFirestore();
    const a = telefoon("AB123C", stand([entry(1000, { savedAt: 5 })], 0));
    await syncOnce(a.host, store.fetchFn);
    let laatst = 0;
    const host: Host = { ...a.host, historyAt: () => laatst, markHistory: (ms) => (laatst = ms) };
    a.host.apply(stand([entry(1000, { savedAt: 5 }), entry(3000, { savedAt: 6 })], 0));
    await syncOnce(host, store.fetchFn);
    await syncOnce({ ...host, read: () => stand([entry(1000, { savedAt: 5 }), entry(3000, { savedAt: 6 }), entry(4000, { savedAt: 7 })], 0) }, store.fetchFn);
    assert.equal(store.history.length, 1);
  }));
