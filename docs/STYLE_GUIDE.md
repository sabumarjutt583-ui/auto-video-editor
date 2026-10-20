# Style Profile Writing Rules

Purpose: a style profile teaches Gemini exactly what a style looks like, so every generated prompt produces the same look. Generic words are useless; concrete visual facts are everything.

Schema: use the existing StyleProfile schema exactly (id, name, category, version, core_identity, medium, lighting, color_palette, camera, composition, texture, characters, mood, negative, motion_rules, style_lock, example_prompt). Every field is required and non-empty. English only.

Reference: `resources/styles/cinematic_realism.json` is the quality bar for depth and tone.

## Field rules

- **core_identity**: 2-3 sentences. What it is, what it feels like, what makes it instantly recognizable.
- **medium**: one precise line (photo, cel animation frame, oil on canvas, clay figures photographed, etc.).
- **lighting, color_palette, camera, composition, texture**: 2-4 concrete sentences each. Name actual qualities (hard vs soft light, light direction, contrast level, saturation level, named colors, lens look, depth of field, line weight, grain, brush strokes). Never use empty words like "beautiful", "amazing", "high quality".
- **characters**: 2-4 sentences on how HUMANS are rendered in this style (proportions, faces, eyes, skin, hair, clothing detail, expression level). This is critical because the app inserts fixed character descriptions from the Character Bible, and they must render consistently in this style.
- **mood**: 4-6 comma-separated words.
- **negative**: 12-25 comma-separated terms. Include (a) the styles this one must NOT drift into, (b) common defects: text, letters, watermark, logo, signature, extra fingers, distorted hands, deformed face, duplicate people, blurry.
- **motion_rules**: 2-4 sentences for video tools: camera movement type and speed, subject movement, and any motion character typical of the medium (for example stop motion: slightly choppy frame-by-frame movement).
- **style_lock**: 12-25 comma-separated words that define the look. Do NOT include an aspect ratio (the app adds it). Must not contradict `negative` (no item may appear in both).
- **example_prompt**: 60-100 words describing this neutral test scene in the style: "an elderly man sitting alone at a kitchen table at night, holding a cup of tea, an empty chair opposite him". It must end with the exact `style_lock`.
- **version**: `"1.0.0"` for new profiles.

## Forbidden everywhere

Fields AND display names must not contain brand, studio, company, franchise, artist, photographer or copyrighted character names (for example Pixar, Disney, Ghibli, Marvel, DC, Dreamworks, specific artist names). Describe the look instead.

## Different from its neighbors

Each profile must be clearly different from its neighbors. If two profiles read similarly, sharpen the differences in lighting, palette, texture and character rendering.

## Files and checks

- One file per style: `resources/styles/<id>.json`. The `id` is lowercase letters, digits and underscores and equals the file name.
- Run `npm run styles:check` before every commit. It prints one row per style (complete / incomplete, problems). A style is "complete" when every text field is filled; complete styles must pass all rules above (the unit tests in `src/lib/styleProfiles.test.ts` fail otherwise).
- The banned-name list lives in `src/lib/styleChecks.ts` (`BANNED_NAMES`) and can be extended with `EXTRA_BANNED` at the top of `src/lib/styleProfiles.test.ts`.
- Admin Edition: open Admin > Style Test, pick the style and run it. It sends a fixed 5-sentence story (`resources/style-test/sample_story.txt`) through the real prompt pipeline and shows the 5 final prompts. Read them and check that the look is the same in all five.
