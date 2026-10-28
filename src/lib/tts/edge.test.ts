import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { edgeLanguages, filterEdgeVoices } from "./edge.ts";
import type { EdgeVoice } from "./api.ts";

const voices: EdgeVoice[] = [
  { name: "ko-KR-SunHiNeural", locale: "ko-KR", gender: "Female" },
  { name: "ko-KR-InJoonNeural", locale: "ko-KR", gender: "Male" },
  { name: "es-ES-AlvaroNeural", locale: "es-ES", gender: "Male" },
  { name: "en-US-AriaNeural", locale: "en-US", gender: "Female" },
];

describe("edge voices", () => {
  it("filters by language code and by full locale", () => {
    assert.equal(filterEdgeVoices(voices, "ko").length, 2);
    assert.equal(filterEdgeVoices(voices, "ko-KR").length, 2);
    assert.equal(filterEdgeVoices(voices, "es").length, 1);
    assert.equal(filterEdgeVoices(voices, "").length, 4);
    assert.equal(filterEdgeVoices(voices, "fr").length, 0);
  });

  it("lists each language once, in first-seen order", () => {
    assert.deepEqual(edgeLanguages(voices), ["ko-KR", "es-ES", "en-US"]);
  });
});
