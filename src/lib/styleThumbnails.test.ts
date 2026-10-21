import assert from "node:assert/strict";
import { test } from "node:test";

import { blankStyle, REQUIRED_FIELDS } from "./styleModel.ts";
import { THUMBNAIL_SUBJECTS } from "./styleThumbnailSubjects.ts";
import { fileStem, matchThumbnailFiles, placeholderColors, thumbnailPromptLine, thumbnailPromptsText, thumbnailView, thumbnailWarnings } from "./styleThumbnails.ts";

const ids = ["noir", "oil_painting", "japanese_ukiyo_e"];
const toUrl = (path: string) => `asset://${path}`;

test("file names are matched to style ids, ignoring case, folders and extension", () => {
  assert.equal(fileStem("C:\\pics\\Noir.PNG"), "noir");
  const result = matchThumbnailFiles(["/a/NOIR.jpg", "/a/Oil Painting.webp", "/a/japanese-ukiyo-e.png", "/a/unknown.png", "/a/noir.png"], ids);
  assert.deepEqual(result.matched.map((m) => m.id), ["noir", "oil_painting", "japanese_ukiyo_e"]);
  assert.deepEqual(result.unmatched, ["unknown.png"]);
  assert.deepEqual(result.duplicates, ["noir.png"]);
});

test("a style without a picture, or whose picture is missing, gets a placeholder instead of a broken image", () => {
  const withPicture = { name: "Noir", thumbnail: "/x/noir.webp", color_palette: "black and white" };
  assert.deepEqual(thumbnailView(withPicture, false, toUrl), { kind: "image", src: "asset:///x/noir.webp" });
  const failed = thumbnailView(withPicture, true, toUrl);
  assert.equal(failed.kind, "placeholder");
  const none = thumbnailView({ ...withPicture, thumbnail: "" }, false, toUrl);
  assert.equal(none.kind, "placeholder");
  if (none.kind === "placeholder") assert.equal(none.letter, "N");
});

test("placeholder colours come from the palette, or are neutral", () => {
  assert.deepEqual(placeholderColors("Sunset orange, hot pink, teal"), ["#f08a24", "#ff4fa3"]);
  const neutral = placeholderColors("");
  assert.deepEqual(neutral, placeholderColors("only one colour: red"));
  assert.equal(neutral.length, 2);
  assert.notEqual(placeholderColors("deep navy and gold")[0], neutral[0]);
});

test("thumbnail prompts use the style\'s own subject, the style lock and 4:3", () => {
  const style = { ...blankStyle(), id: "noir", name: "Noir", category: "Cinematic & Film", style_lock: "classic film noir still, black and white only" };
  const line = thumbnailPromptLine(style);
  assert.ok(line.startsWith(`noir.png | ${THUMBNAIL_SUBJECTS.noir}, classic film noir still`));
  assert.ok(line.endsWith("clean image without any text or watermark, 4:3"));
  const incomplete = { ...blankStyle(), id: "x", name: "X", category: "Painting" };
  assert.equal(thumbnailPromptsText([incomplete]), "\n");
  const complete = { ...style };
  for (const { key } of REQUIRED_FIELDS) complete[key] = complete[key] || "text";
  assert.equal(thumbnailPromptsText([complete, incomplete]).trim().split("\n").length, 1);
});

test("missing thumbnails are warnings", () => {
  const warnings = thumbnailWarnings([{ id: "a", thumbnail: "thumbnails/a.webp" }, { id: "b", thumbnail: "" }, { id: "c", thumbnail: "thumbnails/gone.webp" }], new Set(["a.webp"]));
  assert.equal(warnings.length, 2);
  assert.ok(warnings[0]?.includes("b, c"));
  assert.ok(warnings[1]?.includes("c:"));
});

test("every shipped style has its own subject, and no two subjects are the same", async () => {
  const { readdirSync } = await import("node:fs");
  const ids = readdirSync(new URL("../../resources/styles/", import.meta.url)).filter((n) => n.endsWith(".json") && n !== "package.json").map((n) => n.slice(0, -5));
  for (const id of ids) assert.ok(THUMBNAIL_SUBJECTS[id], `no subject for ${id}`);
  assert.equal(Object.keys(THUMBNAIL_SUBJECTS).length, ids.length, "a subject belongs to a style that does not exist");
  assert.equal(new Set(Object.values(THUMBNAIL_SUBJECTS)).size, ids.length);
});
