# Shot List and Narration — 2:50 cut

Timecodes are targets, not gospel; the voice-over sets the real pace. **VO** is what is said,
**PIC** is what is on screen, **NEEDS** is what has to be true before the take.

Two windows, side by side, for the whole demo: the assistant's chat panel on the left (about a
third), 4.0-reads on the right. Never full-screen one of them — the point of the video is that
both are moving at once. A terminal comes in as a third scene only for the fetch shot.

---

## Cold open — 0:00–0:14

**PIC** Straight into the split screen. A prompt is already typed in the assistant panel; it is
sent on the first word of the VO. Tool calls appear in the chat as the shelf fills behind them.
No title card yet.

**VO** "This is a reading app. That is an assistant, in another window, with no access to my
screen and no plugin driving my browser. It is filling this shelf because the page handed it
tools — typed, named, and its own."

**NEEDS** The tool calls must be visible in the assistant panel. If your client collapses them,
expand them before recording; the whole opening claim rests on the viewer seeing tool names,
not chat.

## Title — 0:14–0:18

**PIC** Title card over a held frame of the shelf: **4.0-reads — an RSS reader an assistant can
use, and cannot overstep.** Four seconds, then straight back.

---

## Act 1 — the baseline is RSS — 0:18–1:08

### Shot 1.1 · Subscribe (0:18–0:34)

**PIC** Type in the assistant panel: *"Find me two good blogs about web platform security, tell
me who they are, and subscribe me to the ones I pick."* It names candidates in prose. Reply with
one name. `subscribe-to-source` fires. Toast: **Subscribed to The Kernel Letter.**

**VO** "It searches, it names what it found, and it waits. Subscribing is the reader's call, so
the tool's own description tells the model not to do it unprompted. The consent step didn't
disappear when the button did — it moved into the conversation."

### Shot 1.2 · The feed URL (0:34–0:44)

**PIC** Settings → Subscriptions, one row reading *No feed URL yet*. Back in chat, the assistant
calls `attach-feed-url`. The row flips to *feed ready — nothing fetched yet*.

**VO** "A subscription without a feed is kept, not refused — who to follow is the part only a
person can decide. The assistant finds the feed and fills it in."

### Shot 1.3 · The fetch runs on my machine (0:44–1:00) — **the privacy shot**

**PIC** Cut to the terminal. `list-subscription-feeds` output piped into the fetcher:

```
node bin/rss-fetch.mjs --feeds -
```

JSON scrolls. Cut back to the split screen as `deliver-rss-items` fires. Toast: **4 new entries
from The Kernel Letter.** The Subscriptions badge increments.

**VO** "No web page can fetch someone else's feed — that is a browser rule, which is why every
hosted reader polls from its own servers and learns exactly who you follow. This one doesn't
have that list. The fetch runs here, on my machine, and the entries come back through a tool."

**NEEDS** Real fixture feeds, served locally — see `demo-setup.md`. Do not hit live feeds on
camera; a slow or changed feed ruins the take.

### Shot 1.4 · The publisher's own words (1:00–1:08)

**PIC** Subscriptions tab. Slow scroll over three cards. Hold on the badge: **RSS · From Simon
Willison's feed**.

**VO** "These are the publisher's own entries, unrewritten. Nothing summarised them."

---

## Act 2 — the assistant is the layer on top — 1:08–1:55

### Shot 2.1 · Inject a topic (1:08–1:26)

**PIC** In chat: *"Research what's new in passkey adoption this week and put it on my shelf."*
`inject-news-to-feed` fires with a topic and several stories. The shelf fills. Toast:
**5 stories added to your shelf.**

**VO** "Now the other pipeline. The assistant searches the web and files what it found — with a
real summary, because this app never fetches the article. That summary is the whole of what I
get unless I follow the link, and the schema says so in as many words."

### Shot 2.2 · Two badges, one shelf (1:26–1:38)

**PIC** Home tab. Scroll so an **AI · Added by ChatGPT** card and an **RSS · From Simon
Willison's feed** card are on screen together. Hold four seconds. *This frame is the thumbnail.*

**VO** "One shelf, two origins, and the card always says which. A model's summary is never
dressed up as a publisher's reporting."

### Shot 2.3 · The redirect (1:38–1:55) — **the strongest shot in the cut**

**PIC** Click **Subscriptions** and stay there. In chat: *"Add three stories about EU AI Act
enforcement."* The Subscriptions tab does **not** change. Toast: **3 stories added to AI finds,
not to your subscriptions.** The AI finds badge increments; click it and there they are.

**VO** "Watch what happens when it files research while I'm standing in my subscriptions. The
stories are stored — but not here. This tab is the people I chose to follow, and an assistant's
prose does not get to sit among them. It isn't dropped, and it isn't silent: it goes to its own
tab, and the app says where."

**NEEDS** Land on Subscriptions *before* sending the prompt, and make the click visible. Without
that setup the shot reads as a normal injection and the point evaporates.

---

## Act 3 — the limits — 1:55–2:32

### Shot 3.1 · Login is a handoff (1:55–2:10)

**PIC** Sign out. In chat: *"Sign me back in."* `start-sign-in` fires; the sign-in form comes up
in the app and the assistant sits waiting. Type the passphrase — or unlock with a passkey and
show the platform prompt. The shelf comes back.

**VO** "An assistant can ask for a sign-in. It cannot perform one. No login tool takes a
passphrase or a recovery key, because the passphrase is what decrypts the library — it is typed
into the page, by the person at the keyboard, and never passes through a model."

### Shot 3.2 · Notes are mine (2:10–2:24)

**PIC** Open a story, type a note at the end of the reader page, click Back, open the Notes tab.
Then in chat: *"Read my library back to me."* `get-current-feed` returns — stories,
subscriptions, saved. Highlight, in the app's own aside: *Your notes are held back from
`get-current-feed`.*

**VO** "A note is the one thing here I wrote myself. A broad 'read my library' is not consent to
hand it over, so the tool takes notes out before it answers — and no tool ships that reads them."

### Shot 3.3 · The server can't read any of it (2:24–2:32)

**PIC** Settings → Account, on the encryption note. Optional two-second insert: a `sqlite3`
`SELECT` over the records table showing ciphertext blobs.

**VO** "And all of it — stories, subscriptions, notes — is encrypted in the page before it is
stored. The server keeps blobs it cannot open."

---

## Close — 2:32–2:50

**PIC** Pull back to the full split screen, shelf populated, both badges visible. Overlay: repo
URL, `11 WebMCP tools · end-to-end encrypted · 108 tests`. Face cam inset optional.

**VO** "Eleven tools, each one narrow enough to say exactly what it can do — and refuse the rest.
That is the point: an assistant that can genuinely use your software, inside limits the software
sets, and keeps."

**NEEDS** Verify the tool count on camera (`state.webmcp.registered`, shown in the sidebar
footer) and the test count (`npm test`) the day you record, and update the overlay to match.
Do not ship a number the repo contradicts.

---

## The 60-second cut

Same footage, four shots, no title card:

| | Shot | Seconds |
| --- | --- | --- |
| 1 | Cold open, tool calls filling the shelf | 0:00–0:12 |
| 2 | Fetch on my machine → `deliver-rss-items` (1.3, tightened) | 0:12–0:28 |
| 3 | The redirect (2.3, uncut — it needs its full beat) | 0:28–0:47 |
| 4 | Notes withheld from `get-current-feed` (3.2) + close card | 0:47–1:00 |

Everything else goes. The short cut sells the boundary, not the feature list.

---

## Export checklist

- [ ] Every visible email, display name, and note belongs to the demo account.
- [ ] No API keys, bearer tokens, or `.env` contents in any terminal frame. Scrub scrollback.
- [ ] Every toast is legible at 1080p — freeze-frame and read each one.
- [ ] No stale UI copy on screen (the "Discover" reference in the empty Subscriptions state was
      removed; check nothing similar has crept back).
- [ ] Tool count and test count in the closing card match a run from the recorded commit.
- [ ] Captions present, spelled correctly for `deliver-rss-items`, `inject-news-to-feed`, WebMCP.
- [ ] Audio peaks under −3 dBFS, voice around −16 LUFS integrated.
- [ ] Watched once end to end **with sound off**, and it still makes its argument.
- [ ] Under the submission's length cap, with five seconds of margin.
