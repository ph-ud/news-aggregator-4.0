# Showcase Video — Production Kit

Everything needed to record a submission video for 4.0-reads (WebMCP Challenge) without
improvising in front of the camera. Three files:

- **`script.md`** — the shot list: timecode, what is on screen, what is said, what has to be
  true for the shot to work.
- **`demo-setup.md`** — the recording environment: seeded account, subscriptions, feed fixtures,
  the exact prompts to type, and how to reset between takes.
- **this file** — format decisions, gear, and the running order of a shoot day.

## What the video has to prove

Judges watch a lot of demos of an assistant clicking around a website. This one is not that,
and the video only works if the difference lands in the first fifteen seconds: **the page hands
the model a set of typed tools, and the model calls them.** No screen-scraping, no DOM
puppetry, no credentials in a prompt.

Three claims, in this order, each shown rather than asserted:

1. **The app is an RSS reader first.** Subscriptions are the baseline; the assistant is the
   discovery layer bolted on top. That ordering is what makes the provenance story credible.
2. **Provenance is enforced, not advisory.** A story is `rss` or `ai`, the badge says which, and
   the tool schemas make it impossible for a caller to label its own prose as a publisher's.
   The redirect shot (an injection while standing on Subscriptions lands in AI finds, with a
   toast saying so) is the single most persuasive twelve seconds in the cut — do not drop it.
3. **The boundaries are real.** No tool takes a passphrase. No tool reads the reader's notes.
   The feed fetch runs on the reader's machine so no server learns who they follow. The library
   is encrypted in the page.

If a shot does not serve one of those three, it is B-roll and it is the first thing cut for time.

## Format

| Decision | Choice | Why |
| --- | --- | --- |
| Length | **2:45–3:00** | Assume a 3-minute cap; check the actual rules before locking picture. Also cut a 60s version — see `script.md`. |
| Voice | **Scripted voice-over over silent screen capture** | Live narration while demoing produces stumbles and dead air waiting for tool calls. Record picture and sound separately, then cut picture to sound. |
| Face cam | **Optional, first and last 10 seconds only** | A small corner inset at the open and close reads as a team; a face over the whole demo steals attention from the UI. |
| Resolution | **1920×1080, 30 fps** | Upscaling a 2560-wide capture makes UI text mushy. Set the browser window to exactly 1920×1080 and capture the window, not the desktop. |
| Music | **Quiet bed, −24 LUFS under a −16 LUFS voice** | Or none. Music that fights the voice-over is worse than silence. |
| Captions | **Burned-in or SRT** | Many judges watch muted. Non-negotiable. |
| Cursor | **Highlighted, click-emphasis on** | The eye needs to know where the action is; tool calls happen in one panel and the result appears in another. |

## Gear and software

Nothing exotic is needed. What matters is that terminal text and the app's small type stay
legible after the platform re-encodes.

- **Capture** — OBS Studio (free, cross-platform). One scene per source: browser window, agent
  panel, terminal. Switching scenes beats juggling windows on camera.
- **Audio** — any USB condenser or a decent headset, recorded in a soft room. Phone voice memos
  in a closet beat a laptop mic in an office.
- **Edit** — DaVinci Resolve (free) or Descript (edits video by editing the transcript, which
  suits a voice-over-led cut).
- **Zoom** — do not zoom the browser to make text readable in post. Set the page zoom to 125%
  *before* recording, and bump the reader's text size in Settings → Reading for reader shots.

## Running order for the shoot

1. **Build the demo state** — follow `demo-setup.md` end to end once, and snapshot the database
   (`cp data/4.0-reads.db data/demo-snapshot.db`). Every take restores from that snapshot.
2. **Record the voice-over first.** Two or three clean passes of the whole script. Pick the best
   read per paragraph. Sound is now fixed; picture is cut to it.
3. **Record picture in blocks**, in script order, each block one continuous take:
   - Block A — sign-in handoff and the tool list
   - Block B — subscribe → attach feed → fetch on the machine → deliver
   - Block C — inject a topic, the AI finds tab, the provenance badges, the redirect
   - Block D — reader page, note, notes withheld from `get-current-feed`
   - Block E — settings, encryption panel, passkey unlock
   Re-record a block, never a single shot; matching cursor position across a cut is a nightmare.
4. **Assemble to the voice-over**, then trim every dead frame where a tool call is thinking.
   Speed-ramp waits to 4× rather than cutting them out entirely — a visible, brief wait is
   honest and reads as real software.
5. **Pass the checklist** in `script.md` before export.

## Pre-flight

Run these once, the day of. A failure on camera costs an hour.

```bash
node --version          # must be >= 22.5 for node:sqlite
npm test                # 108 tests, all green
npm run dev             # http://localhost:4173
```

Also check, in the browser you are recording in:

- `document.modelContext?.registerTool` exists — without it no tool registers and there is no
  demo. The sidebar footer reads "WebMCP ready · N tools" when registration succeeded; that
  line is a good, quiet on-camera proof and worth one insert shot.
- The window is exactly 1920×1080 and the OS menu bar, dock, notifications, and any personal
  bookmarks are hidden. Do Not Disturb on.
- The account you demo with is the seeded demo account, not a personal one. Email and display
  name are the two things a database dump *does* reveal, and they will be on screen.

## Deliverables

- `4.0-reads-demo-1080p.mp4` — H.264, ~10–15 Mbps, AAC 192 kbps stereo.
- `4.0-reads-demo-60s.mp4` — the short cut, for the README and social.
- `captions.srt`
- A 1920×1080 thumbnail frame: the shelf with both badges visible, "From The Kernel
  Letter's feed" next to "Added by ChatGPT". That single frame is the whole thesis.
