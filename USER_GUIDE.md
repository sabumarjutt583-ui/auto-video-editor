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

## Motion graphics (free, written by the AI)

In the Auto Editor, open the **Motion** tab, pick a scene and press **Make a motion graphic**. You can write what it should show (for example "a bar falling from 100 to 50") or leave it empty and the AI chooses what fits the words. It takes about a minute. It uses the Google accounts from Settings > Image Generator, so add at least one. Use the arrows to make it again, the slider to move it in time, and the tick to switch it off. It is added on top of the video when you render (not in the small preview). Graphics keep the shape of the video they were made for: a 16:9 graphic is not used in a Shorts (9:16) render.

## SFX Library

Open **SFX Library** in the left menu. Sounds are grouped by kind (whoosh, hit, pop, riser, ambience, soft swell, click, transition). You can:

- search by tag (for example "fast" or "boom"),
- press ▶ to listen,
- press ☆ to mark a favorite (use the **Favorites** button to show only those),
- press **+** to add the sound at the start of the scene that is selected in the Auto Editor (it appears on the timeline, and you can move it there).

At the bottom, **Check for library update** downloads new sounds and styles if the publisher put some online. The app checks automatically when it starts. If a new package is damaged, nothing changes. **Go back to the version before** undoes an update.

## Settings

**Text engine.** Scene groups, characters and prompts are written by Gemini. Choose *Gemini API key* (fast, daily limit) or *Web chat (free)*, which uses the Google accounts of the Image Generator and needs no key.

- **API keys**: paste, **Save**, **Test Key**, **Delete**. Keys are kept only in your computer's secure keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service). They are never written to files or logs.
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
