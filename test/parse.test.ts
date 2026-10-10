import assert from "node:assert/strict";
import { test } from "node:test";

import { parseGetal } from "../src/core/parse.js";

test("parseGetal neemt komma én punt aan", () => {
  assert.equal(parseGetal("63,5"), 63.5);
  assert.equal(parseGetal("63.5"), 63.5);
  assert.equal(parseGetal(" 84210 "), 84210);
  assert.equal(parseGetal(",5"), 0.5);
  assert.equal(parseGetal("-3"), -3);
});

test("parseGetal: leeg of onzin is null, nooit 0", () => {
  for (const raw of ["", "  ", "abc", "1e3", "0x10", "Infinity", "1,2,3", "4 5", "-"]) {
    assert.equal(parseGetal(raw), null, raw);
  }
});
