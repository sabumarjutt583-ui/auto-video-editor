import assert from "node:assert/strict";
import { test } from "node:test";

import { wavBytesFromAddress } from "./sample.ts";

test("a WAV address is turned into its bytes", () => {
  const bytes = wavBytesFromAddress(`data:audio/wav;base64,${Buffer.from("RIFFxxxxWAVE").toString("base64")}`);
  assert.equal(new TextDecoder().decode(bytes), "RIFFxxxxWAVE");
});

test("another kind of address is refused", () => {
  assert.throws(() => wavBytesFromAddress("data:text/plain;base64,QQ=="), /not a WAV/);
});
