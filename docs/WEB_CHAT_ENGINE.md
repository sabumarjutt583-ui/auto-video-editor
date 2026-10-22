# Web chat engine (Gemini in the browser)

Status: part 1 (diagnosis). Later parts update the "Design" section.

## How it works today
- `ImageGen::chat_ask` (imagegen/ops.rs) picks a free Google account (`claim_chat`), then `FreeWorker::chat`
  (worker.rs) -> `chat::ask_with_images` (chat.rs).
- Every question opens a NEW tab in the account's browser, navigates to gemini.google.com/app, inserts the text,
  clicks Send and polls the page. The tab is closed afterwards. There is no thread reuse.
- The browser is the same one the image engine uses (`FreeWorker::ready`, per-account profile, `Mode::Hidden`
  = `--headless=new` by default).
- `generate_text` (commands/ai.rs) with `textViaChat` sends `system + prompt` as ONE message per call.
- Prompt batches: `generatePrompts` (src/lib/prompts/generate.ts) calls `call(system, prompt)` for every batch of 20;
  the system instruction (style, bible, rules) is repeated in every message.

## Root causes found
1. **"Gemini did not start an answer" (the screenshot).** `wait_for_answer` fails as soon as no `model-response`
   element exists after `replyStartMs` = 25 s. Gemini thinking about a 20-scene batch often shows only the spinner
   and stop button for much longer, so a healthy generation was declared dead. Only the *start* is judged by one
   selector; the stop button / thinking indicator is never looked at.
2. **Wrong error kind.** The failure is reported with `ErrorKind::NoImage` (an image-engine error) and the text
   "NoImage" appears in Details.
3. **Resend loop.** `generatePrompts` retries every failed batch `BATCH_RETRIES = 2` times immediately, each retry
   is a new tab and a new chat, and the old chat may still be generating. `ops.rs` also tries the next account
   for some errors. Result: tabs opening/closing, refreshes, repeated messages, and Gemini's
   "I seem to be encountering an error" in interrupted chats.
4. **Stability rule ends early.** If the answer text is unchanged for `stableMs` = 9 s, the reply is accepted even
   if Gemini is still generating (no check that the stop button is gone).
5. **Everything in one huge message.** Style profile + bible + rules + scenes are sent in each batch message; there
   is no setup message, no READY check, no batch id, no reminder block, no verification of the returned prompts.
6. **Visible Chrome window.** The default mode is hidden, but the browser runs as a normal (minimized) window when
   `browserMode = window`. That is set automatically and persistently by `engine.rs::handle_error` and
   `ops.rs::verify_inner` when Google refuses the hidden browser, and can be chosen in Settings. In window mode
   `Target.createTarget` for the chat tab can bring the window up, so the user sees a Chrome profile with two tabs
   (image tool + gemini.google.com/app). The sign-in window (PlainWindow) is visible by design.
7. **Narration text.** The scene text sent comes from the scene model; with Groq timing it can be the Whisper
   transcript instead of the user's script (typos), and short scenes (0.6 s, 1.4 s) are never merged.

## Step log
Every step is written to the app log (target `webchat`, no keys, no account details): browser launch mode, tab
opened, navigation, message inserted/sent, waiting, answer finished/failed, tab closed.

## Design (parts 2-6)
See the task parts: hidden shared browser (2), reliable driver that never interrupts (3), one thread per project with
setup + READY + batches with reminder block + verified prompts (4), user script + min scene length (5), manual
copy-paste mode (6).

## Part 3: the driver (done)
- Started = Stop button OR a new answer element OR a thinking indicator (wait up to `replyStartMs`, now 180 s).
- While Stop is visible the driver only waits (up to `thinkMaxMs` 300 s) and reports "Gemini is thinking... N s".
- Finished = Stop gone and the text unchanged for `finishStableMs` (2 s). Without a Stop button ever seen, the old
  careful rule (`stableMs` 9 s or the Good-response marker) is used.
- Never refresh / navigate / open a new chat / resend while waiting. A failed call is not sent again by the app
  when `textViaChat` is on (`resendOnError: false`).
- Chat error kinds: `no_response`, `response_timeout`, `soft_failure`, `invalid_json`, `missing_ids`, `page_changed`
  (plus the shared `rate_limit`, `auth`, `flagged`, `network`). Never `no_image`.
- On failure a screenshot + short page summary go to the log folder (`webchat-fail-<time>.jpg/.txt`).
- Selectors and timings: resources/image-engine/config.json `chat` block (configVersion 1.3).

## Part 4: conversation design (done)
- Code: src/lib/prompts/chat/{messages,parse,verify,runner,threadStore,tauriTransport}.ts (+chat.test.ts); Rust
  `imagegen_chat_thread` (ops.rs `chat_thread`, chat.rs `ask_thread`).
- One thread per project / quick session (address + account stored in localStorage `chatThreads`); a new thread only
  when none is stored, after a soft failure, after 15 batches, after a batch with more than 30% fixed rows, or when the
  stored account is busy/resting.
- Message 1 = SETUP (text-only line, task, full style profile, bible, rules, JSON format; ends "Reply with the single
  word READY."). Every batch message starts with the reminder block (BATCH_ID, style lock, exact looks, JSON format).
  Batch = 20 scenes (setting 5-25), reduced automatically to keep a message under 6,000 characters.
- Before sending into a stored thread the page is read: if `BATCH_ID: <id>` is already there, the app waits for that
  answer instead of sending again.
- Answers: JSON from a code block, plain or with words around it; ids checked and reordered; missing ids asked once in
  the same thread. Each prompt is verified: style lock last (partial lock replaced), exact character and location text,
  banned words removed, length flagged. Changed rows get a "fixed" / "check" badge with the list as tooltip
  (`Scene.fixNotes`).
- Soft failures ("encountering an error", "hard time fulfilling", READY missing): wait 30 s, ONE new thread with setup,
  same batch once; a second failure stops with Gemini's reply in Details. Usage limit: the account rests and the batch
  moves to the next account (own thread + setup).

## Part 5: script text and scene length (done)
- The narration of every scene is the user's script (`alignScript`: the script's wording wins over the recognised
  speech); the chat messages use `scene.text`. Without a script the Scenes step shows "narration comes from speech
  recognition".
- Scenes shorter than `sceneSettings.minSeconds` (default 2.0, 0 = off) are joined to the previous scene (to the next
  if first) in all modes; ids and timecodes are renumbered (src/lib/scenes/short.ts, tests in short.test.ts).
