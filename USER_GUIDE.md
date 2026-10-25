# Auto Video Editor: User Guide

This guide is for people who make narration videos (with pictures or clips and a voice-over) and want the computer to do the editing.

## What you need

- Your **voice-over** (mp3, wav, m4a, aac, ogg or flac) and your **script** (the exact words you read).
- A tool that makes pictures or video clips from prompts (any image/video AI you like).
- Optional, free keys (Settings): **Groq** (finds the exact time of every word) and **Google Gemini** (cuts the story into scenes and writes the prompts). **Without keys** you can still use your own SRT/JSON timing file, cut scenes by sentence or seconds, import media in order, edit and render.

The first time you open the app, three short screens explain this and let you add the keys or press **Skip for now**. You can add them later in **Settings**.

## The parts

1. **Prompt Generator**: voice-over + script → scenes → prompts for your picture/video tool.
2. **Image Generator** (optional): makes the pictures for you from those prompts.
3. **Auto Editor**: your pictures/clips → finished video.

Everything is saved automatically in your **Projects**.

## Quick prompts (no project)

Open **Prompt Generator**. The first choice, **Quick prompts**, needs no project. Paste your script, pick *every sentence*, *every line* or *every scene* (the AI groups sentences by meaning), press **Build the prompts**, choose a style and write the prompts. Prompts are called P01, P02 ... With **Voice + timing** you can add a voice-over and get timecodes (S01_000.0-005.1) instead. Your work saves itself and comes back when you reopen the app. **New quick session** clears it. **Save as project** turns it into a normal project (so you can use the Image Generator and the Auto Editor). Use **Engine** to write with your Gemini key or with the free web chat.

**Copy all / Export TXT** leave empty lines between prompts (1, 2 or 3, you choose), and **Include IDs** switches the ID before each prompt on or off. To make pictures from copied prompts, paste them into Image Generator > Only images.

## Part 1: Prompt Generator

Open **Projects → New project**, give it a name and choose the language. Then go through the five steps at the top of the Prompt Generator. A step opens when the one before it is done.

1. **Voice**: drop your voice file. Check where long silences are (the preview), press **Apply** to remove them (the new file is shorter and still sounds natural), or skip it. Then press **Lock**. After locking, the voice cannot change (you can unlock it, which clears the later steps).
2. **Timing**: paste your script. Choose where the word times come from:
   - **Groq**: the app listens to the voice and finds every word's time (needs the Groq key).
   - **SRT or JSON file**: upload timings you already have.

   The preview plays the voice and highlights the spoken word. If the script and the voice do not match, a warning shows where.
3. **Scenes**: choose how to cut the story: **per sentence**, **per seconds**, or **AI** (Gemini groups the sentences that belong together). Scenes have no gaps: the last one ends exactly when the voice ends. You can edit text, merge, split, and set a scene as picture or video.
4. **Style & cast**: pick a **style** (51 built in, plus your own). Gemini can find the **characters** and **locations** and write a fixed English description for each; you can edit them. These descriptions are copied word for word into every prompt where the character appears, so they look the same in every picture.
5. **Prompts**: choose the tool, detail level and output type, then **Generate**. Prompts are written in groups of 20 scenes. Every prompt **starts with its timecode** and **ends with the style lock**. Use **Copy all**, or export **TXT, CSV or JSON**.

### The file naming format (important)

Make one picture or clip per prompt and **name the file with the timecode at the start of the prompt**:

```
S01_000.0-005.1.png
S02_005.1-011.8.jpg
S03_011.8-016.0.mp4
```

The pattern is `S` + scene number (2 digits) + `_` + start second + `-` + end second (each with one decimal, three digits before the point). **Never use a colon (:)** in file names. Accepted types: png, jpg, jpeg, webp, mp4, mov, webm.

## Part 2: Auto Editor

### Step 1: Media

Drop your folder (or files) into the box. Files named like `S01_000.0-005.1.png` go to their scene by themselves. If the names are different:

- **Bulk Rename** puts the right names on your files (by order), and shows you the result before changing anything.
- Files can also be matched **by order**, or with **Gemini** (it looks at the pictures and the scene text; needs the Gemini key).
- Anything that does not fit stays in the tray, and you can drag it to a scene.

A red warning shows when a file was deleted or moved, or when a clip is shorter than its scene (the app slows it down a little, then holds the last frame). Scenes without a file can show the previous picture, a blurred picture, or black.

### Step 2: Edit

Panels: **Storyboard**, **Scene settings**, **Captions**, **Audio**. At the bottom is the timeline, and above it the preview, which plays together with your voice.

- **Storyboard**: all scenes with pictures. Click a scene to select it, drag to swap two.
- **Scene settings**: Ken Burns motion (zoom/pan direction), how a video fits (crop or blurred background), speed, transition, emphasis.
- **Timeline**: drag the edge between two scenes to change their times (both scenes follow). **Ctrl+Z** undoes, **Ctrl+Y** redoes, **Space** plays and pauses, and the arrow keys jump between scenes.
- **Captions**: presets (Clean Bottom, Word Highlight, Pop Word, Boxed, Documentary, or None), font size, colors, position, per language. Korean, Japanese, Chinese, Nepali, Hindi, Arabic and Urdu show correctly (Urdu uses an Arabic-style font). Export **SRT** from here.
- **Audio**: add music (it loops or fades), choose how much the music lowers while you speak (ducking), and let the app place **sound effects** at scene changes and emphasis. You can move, change or delete every effect. **Build audio mix** makes the sound and shows its loudness (about -14 LUFS).

### Render the video

Press **Render video** (top right of the Auto Editor). Choose:

- **Format**: 16:9, 9:16 or 1:1
- **Quality**: 720p, 1080p or 4K
- **Frame rate**: 24, 30 or 60
- **Transitions**: Cut, Fade, or Mixed (mostly cuts, some fades and slides)
- **Ken Burns** on or off

The window shows the percent, the current step and the time left. **Cancel** stops it and removes the temporary files. When it is done you get a card with **Play**, **Open folder**, the file size and the length. The app checks that the video is as long as your voice (within 0.1 seconds).

Files are saved in your project's `exports` folder (and in your export folder from Settings, if you chose one) as `ProjectName_16x9_2026-10-18.mp4`, with `captions.srt` next to it.

**Render Shorts version (9:16)** (a button in the same window) makes a vertical video from the same project, with the captions placed for tall screens.

A graphics card (NVIDIA, Intel, AMD, Apple) is used automatically when it works, which is much faster. In **Settings → Video encoding** you can force the CPU instead.

## Image Generator

Open **Image Generator** after you wrote the prompts. It makes one picture per scene and puts it in the project with the right name, so the **Auto Editor** shows it at once.

The page has two modes. **Project scenes** makes one picture per scene of the open project. **Only images** needs no project: choose a folder, paste your own prompts (`Prompt 1: ...` blocks or one prompt per line), pick the shape and press **Add and generate**. The pictures are saved in the `media` folder inside your folder as `Image 001.png`, `Image 002.png`...

1. Pictures are made with your own Google account. Read the notice that appears the first time. We recommend a separate Google account, not your YouTube channel account.
2. In **Settings → Google accounts** (or on this page) **Add account**, press **Sign in**, sign in in the browser window that opens, then press **I have signed in** (Windows closes the window for you). Press **Verify**, and **Test image** to make one picture. Add more accounts to make more pictures before a limit is reached.
3. Press **Generate all scenes**. The counters show queued, generating, completed and failed. **Pause** and **Resume** are always possible; closing the app in the middle is safe.
4. **Retry failed** tries the failed ones again. Tick scenes and press **Regenerate selected**, or use the arrows on a scene. The pencil edits that scene's prompt.
5. **Open in Auto Editor** when you are happy.

If an account reaches its daily limit, only that account waits (the time is shown); the others continue. If Google asks you to check something (captcha, "unusual activity"), the account is paused and you see the message: open the account's browser, do the check yourself, then Verify.

## Writing prompts with the Gemini web chat, or by hand

In the Prompt Generator (Project and Quick) you choose the **Engine**: **API key**, **Gemini web chat (automatic)** or **Manual (copy & paste)**.

**Gemini web chat.** The app uses the Google accounts you added in Settings. It works in a hidden browser (no Chrome window appears). It sends one setup message, waits for `READY`, then sends your scenes in batches of 20 (change this in Settings, Text engine) in the same chat. While Gemini is thinking the app only waits ("Gemini is thinking... 42 s"); it never refreshes the page or sends a message twice. If Gemini gives a generic error, the app waits 30 seconds and tries once in a new chat. If that fails too, it stops and shows Gemini's reply in Details. Cancel stops after the current answer is finished.

**Checked prompts.** Every prompt must end with your style's exact style lock and contain the exact looks of every character and the location text. If Gemini forgot something, the app adds it and marks the row **fixed** (hover to see what changed). A row marked **check** looks odd (for example very short) but was not changed.

**Manual (copy & paste).** Press "Prepare messages". Copy message 1 (Setup) into any AI chat (Gemini, ChatGPT, Claude...), then each batch message in the same chat. Paste each answer into the box under the message and press **Use answer**. The app tells you if scene IDs are missing and gives you a follow-up message for them. No browser, account or key is needed.

**Your words.** Scene text is your own script, not the speech recognition text (without a script the Scenes step says so). Scenes shorter than 2 seconds are joined to a neighbour (Scenes step, "Shortest scene").

**Deleting.** Prompts step: the bin button on a row, the checkboxes with "Delete selected", and "Clear all prompts" (your script and scenes stay). An Undo bar stays for 10 seconds. Image Generator: delete one picture, the selected ones, or "Delete all images". Pictures go to the Recycle Bin / Trash and are not made again; in a project the scene shows as missing and you can press Regenerate.

## Motion graphics (free, written by the AI)

In the Auto Editor, open the **Motion** tab, pick a scene and press **Make a motion graphic**. You can write what it should show (for example "a bar falling from 100 to 50") or leave it empty and the AI chooses what fits the words. It takes about a minute. It uses the Google accounts from Settings > Image Generator, so add at least one. Use the arrows to make it again, the slider to move it in time, and the tick to switch it off. It is added on top of the video when you render (not in the small preview). Graphics keep the shape of the video they were made for: a 16:9 graphic is not used in a Shorts (9:16) render.

**Automatic graphics.** In the Motion tab press **Generate graphics**. The app finds numbers, money, percentages, dates, places, names, lists and quotes in your narration, the AI picks the few moments that deserve a graphic and the app draws them in your brand kit. Choose **Few, Normal or Many** first. Many scenes stay clean on purpose. **Only for S05** does one scene, and the round arrow on a graphic makes a new one. Graphics you made yourself are never replaced.

**Quality check.** In the Motion tab, **Check graphics** looks for text that does not fit, text that is hard to read on the picture, graphics that disappear too fast, letters the font cannot draw, graphics over a face or the captions, and graphics that overlap or leave their scene. **Fix what can be fixed** repairs the safe ones (a dark plate behind text, more time, a better place). A warning triangle marks graphics with a problem left. The same list appears when you press Render; it never stops the render.

**Edit a graphic.** Graphics have their own **Graphics** row on the timeline. Click one to edit it: change its texts and numbers (press **Apply changes**), drag it on the preview picture, drag its edges on the timeline to change when it shows (it snaps to the spoken words), pick how it comes in and goes out, or give it its own colours. **Duplicate**, **Remove** and undo/redo work as everywhere else. **Save as preset** keeps a graphic in **My Presets** with its texts as blanks; add it to any scene with your own words. The AI sees your presets as examples of the look you like.

**Sounds for graphics.** In the Audio tab, **Add soft sounds for motion graphics** (on by default) adds a quiet pop or whoosh when a graphic comes in, light ticks while a counter counts, and a swoosh when a map draws a route. Nothing plays when a graphic leaves. They appear on the SFX track, so you can move or delete any of them. They follow the "How many effects" choice and the effects volume.

**Graphics cache.** Graphics you drew once are kept, so drawing the same one again is instant, and several graphics are drawn at the same time. **Settings > Graphics cache** shows how much room they use (at most 5 GB; the oldest go first) and has a **Clear cache** button. Clearing it never removes graphics from your projects.

**Brand kit.** In the Motion tab, open **Brand kit** to choose the look of your graphics: three ready-made kits (Clean Documentary, Bold News, Soft Story), kits that match your visual style (for example Noir gives grey tones and capital-letter titles), or your own. Change colours, round corners, line thickness, shadow and movement, watch the four sample pictures change, then press **Save as my kit**. **Use for all projects** makes it the default.

## SFX Library

Open **SFX Library** in the left menu. Sounds are grouped by kind (whoosh, hit, pop, riser, ambience, soft swell, click, transition). You can:

- search by tag (for example "fast" or "boom"),
- press ▶ to listen,
- press ☆ to mark a favorite (use the **Favorites** button to show only those),
- press **+** to add the sound at the start of the scene that is selected in the Auto Editor (it appears on the timeline, and you can move it there).

At the bottom, **Check for library update** downloads new sounds and styles if the publisher put some online. The app checks automatically when it starts. If a new package is damaged, nothing changes. **Go back to the version before** undoes an update.

### Make your own style from pictures

Open the **Style Gallery**, go to **My Styles** and press **Create style** (or use **Create custom style** next to the style picker).

1. Type a **name** and choose a **category** (My Styles is the default).
2. Add **3 to 20 pictures** (the web chat looks at up to 10 of them, spread over the set) that share one look: drop them on the window or click the dashed card. PNG, JPG or WebP, up to 10 MB each. Remove one with the X.
3. Write a few words about the look, the mood or what to keep (**Description**, recommended).
4. Choose what studies the pictures: **Gemini** or **OpenAI** (they need a key in Settings) or the **Gemini web chat** (your Google accounts, no key).
5. Press **Analyze with AI**. The AI describes only the look the pictures have in common, not what is in them. If its first answer breaks a writing rule, it is asked once more automatically.
6. **Review**: every field can be changed. **Regenerate** asks the AI again. **Test style** writes 3 sample prompts so you can see the style at work. Then **Save style**.

The style appears in **My Styles** with the first picture as its thumbnail and can be used everywhere, in projects and in Quick prompts. Your pictures are kept with the style: choose it and press **Re-analyze** to study them again. **Edit**, **Duplicate** and **Delete** work as for other styles. **Export** saves the style and its pictures as one `.avstyle` file; **Import style file** (in My Styles) adds such a file, for example from a friend, as a new style.

If the web chat shows a captcha or "unusual activity" page, the account is paused and you finish the check yourself in its window, as for the Image Generator.

## Settings

**Text engine.** Scene groups, characters and prompts are written by Gemini. Choose *Gemini API key* (fast, daily limit) or *Web chat (free)*, which uses the Google accounts of the Image Generator and needs no key.

- **API keys**: paste, **Save**, **Test Key**, **Delete**. Keys are kept only in your computer's secure keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service). They are never written to files or logs.
- **OpenAI key** (optional): only used to let an OpenAI model look at pictures when you make a custom style.
- **Models**, **defaults** (aspect ratio, quality, export folder), **Video encoding**, **Library updates**, **Updates**, **Help and logs**.

### Updating the app

When a new version is published, a banner appears: **Update now**. The update is checked and installed for you. Your projects are not changed.

### If something goes wrong

Every error shows a short message and a **Details** button with the technical text. If you need help, open **Settings → Help and logs → Export logs**, choose a folder, and send the file you get. It contains no API keys. Turn on **Debug logging** only when the person helping you asks for it.

## Install and update

**Install.** Download the app for your computer from the download page of the website:

- **Windows:** run `AutoEditor-windows-x64-setup.exe`. If "Windows protected your PC" appears, click **More info**, then **Run anyway**.
- **Mac:** open the `.dmg` and drag the app to Applications. If the app cannot be opened, right-click it, choose **Open**, then **Open** again.
- **Linux:** make the `.AppImage` executable (right-click > Properties > Allow executing) and open it, or install the `.deb`.

These warnings only appear the first time.

**Update.** The app looks for a new version a few seconds after it starts (at most once a day). When there is one, a bar at the top says **Version X.Y.Z is available** with a short note about what is new.

1. Press **Update now**. You see the download progress (percent and MB). The update is checked for safety, installed, and the app starts again by itself.
2. Press **Later** if you are busy. The bar comes back at the next check.
3. If a render or another long task is running, the app asks you to wait until it is finished, or to cancel it, before it updates.

Your projects are never touched by an update. In **Settings > Updates** you can see your version, press **Check for updates**, see when the last check was, and switch **Check for updates automatically** on or off. If something goes wrong (no internet, for example) you get a clear message with a **Details** button, and the app keeps working as before.

New styles and sound effects are delivered separately (see **Settings > Library updates**) and do not need an app update.

## Questions

**Where are my projects?** In the app's data folder, in `projects`. Each project is a folder with everything in it (voice, pictures, exports).

**Can I use the app without the internet?** Yes, for everything except Groq timing, Gemini and updates.

**My language is not in the list.** Choose the closest one; the timing and captions work with any language that Whisper understands, and your own SRT file works for every language.


## Voice-over in several parts
If your voice-over comes in parts, use the **Voice-over parts** bar at the top of the Prompt Generator. Click **Add next part** to start a new part (called Part 2, Part 3 ...), then upload its voice and continue with timing, scenes and prompts. Click **Rename** to give the open part a name. Click a part name to go back to it; nothing is lost. Style, cast and settings are shared by all parts. Remove a part with the bin icon next to its name.


## Videos with Gemini (no API key)
In **Image Generator > Project scenes** the **Videos** panel makes short videos (about 10 seconds each) with Gemini's "Create video", using your signed-in Google accounts.
1. Choose the scenes (start with "Scenes marked as video", or pick some by hand).
2. Leave "Animate the scene's picture" on to bring a picture to life, or turn it off to make the video from the scene's words.
3. Press **Make N videos**. Each ready account makes one video at a time (1 to 3 minutes each). The finished `.mp4` is saved in the project's media folder with the scene's timecode name, and the Auto Editor uses it.
Every Google account can make only a few videos a day (about 4 to 5 on Pro). When Gemini says an account is out of videos, the app shows when it is back, uses your other accounts meanwhile, and (with "Keep going when accounts come back") waits and continues. Use the videos for your most important scenes and pictures with camera motion for the rest.

## Videos with Google Flow
In the Image Generator, Videos card, choose where the videos are made: **Google Flow** (Veo, about 10 credits per 8-second video; a Pro account has about 1,050 credits a month), **Gemini** (a few videos a day per account) or **Auto** (Flow first, Gemini when Flow credits are used up). The scene's picture becomes the first frame, so the video keeps the same person and place. Each Google account makes one video at a time; an account without credits rests and the others carry on. If Google asks for a check (captcha), the account is paused: open its window and finish the check yourself.
