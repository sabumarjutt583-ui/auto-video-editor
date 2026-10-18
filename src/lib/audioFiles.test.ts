import assert from "node:assert/strict";
import { test } from "node:test";

import { fileExtension, fileName, isAcceptedAudio } from "./audioFiles.ts";

test("accepts the six audio types in any letter case", () => {
  for (const name of ["a.mp3", "b.WAV", "c.m4a", "d.aac", "e.Ogg", "f.flac", "C:\\voices\\g.mp3", "/home/u/h.flac"]) {
    assert.ok(isAcceptedAudio(name), name);
  }
});

test("refuses everything else", () => {
  for (const name of ["a.mp4", "b.txt", "noext", ".mp3", "c.mp3.exe", "folder/"]) {
    assert.ok(!isAcceptedAudio(name), name);
  }
});

test("reads names and extensions from Windows and Unix paths", () => {
  assert.equal(fileExtension("C:\\x\\Voice.MP3"), "mp3");
  assert.equal(fileName("C:\\x\\Voice.mp3"), "Voice.mp3");
  assert.equal(fileName("/a/b/c.wav"), "c.wav");
});
