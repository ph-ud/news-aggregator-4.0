# Demo Environment

A recording is only as good as the state behind it. Build this once, snapshot it, and restore
the snapshot before every take so each block starts from the same shelf.

## 1. The app

```bash
node --version                 # >= 22.5, for node:sqlite
npm test                       # 108 tests — a red suite is not a thing to record over
DATABASE_PATH=./data/demo.db npm run dev
```

`http://localhost:4173`. A separate `DATABASE_PATH` keeps your real library out of frame and
makes the snapshot/restore below safe.

Record in a browser where `document.modelContext.registerTool` exists — without it nothing
registers and the sidebar footer reads "Library ready" instead of "WebMCP ready · 11 tools".
Check it in the console before you set up lights.

## 2. The fixture feeds

`fixtures/` holds two feeds — one RSS 2.0, one Atom, so the demo exercises both halves of
`src/rss.js`. Serve them locally:

```bash
cd docs/demo-video/fixtures && python3 -m http.server 8081
```

- `http://localhost:8081/kernel-letter.xml` — The Kernel Letter, 4 entries
- `http://localhost:8081/quiet-column.xml` — The Quiet Column, 3 entries

Both are verified to parse through the real fetcher:

```bash
node bin/rss-fetch.mjs --allow-local http://localhost:8081/kernel-letter.xml
```

`--allow-local` is required: the fetcher refuses loopback addresses unless you say you meant it.

**Why fixtures rather than a real blog.** A live feed can be slow, empty, or different from the
take before, and a retry mid-shoot is expensive. Fixtures make the fetch shot deterministic.

**If you would rather record against a real publication** — and it does look better — then use
that publisher's *real* feed and their *real* entries. Never put a real publisher's name on
invented posts: the RSS badge's entire claim is that the words under it are genuinely theirs,
and staging that is precisely the thing this app exists to make impossible.

## 3. The demo account

Sign up in the app as the assistant's prompt drives it, or beforehand:

- Name: `Demo Reader`
- Email: `demo@4.0-reads.example`
- Passphrase: something you are willing to type on camera, and used nowhere else.

A dump reveals email, display name, record count, and write timestamps — that list is in
`AGENTS.md` and it is exactly why the demo account is not your account.

Write the recovery key down off-camera; a sign-up will not proceed past it. If the passkey shot
is in your cut, enrol a passkey now (Settings → Account → Open security) and confirm the
platform prompt appears in a *capturable* window — some OS dialogs do not appear in window
capture and need a display capture scene.

## 4. Seeding the shelf

Do not record against an empty library — a first-run shelf makes the app look unfinished. Seed
it through the tools themselves, which is also a rehearsal of the shoot:

1. Subscribe to The Kernel Letter (`https://kernel-letter.example`) and The Quiet Column, each
   with its `localhost:8081` feed URL.
2. Fetch and deliver both feeds.
3. Inject two or three AI topics that are *not* the topic you will demo live — so Home already
   has a mixed history, and the live injection is visibly new.
4. Save two stories. Write one note. Open and read three stories so the "read stories recede"
   treatment is visible and the unread badges show a believable number rather than everything.
5. Leave the topic you will inject on camera **unused**, and leave one subscription with **no
   feed URL** if you want the `attach-feed-url` shot to have something to attach to.

Then snapshot:

```bash
cp data/demo.db data/demo-snapshot.db
```

Restore between takes (stop the server first):

```bash
cp data/demo-snapshot.db data/demo.db
```

The browser also holds the unwrapped master key and the session, so a restore that predates
your sign-in will drop you to the sign-in form. That is fine — it is the same form Shot 3.1
needs. Clear site data only if you want to re-record sign-up from scratch.

## 5. The prompts, in order

Type these verbatim; they are what the script's timings assume. Keep them in a text file and
paste, so a typo does not cost a take.

| Shot | Prompt |
| --- | --- |
| Cold open | `Fill my 4.0-reads shelf with what's worth reading on the web platform this week.` |
| 1.1 | `Find me two good blogs about web platform security, tell me who they are, and subscribe me to the ones I pick.` → then reply with one name |
| 1.2 | `That subscription has no feed URL — find its feed and attach it.` |
| 1.3 | `List my subscribed feeds, fetch them on this machine with bin/rss-fetch.mjs, and deliver the entries.` |
| 2.1 | `Research what's new in passkey adoption this week and put it on my shelf.` |
| 2.3 | `Add three stories about EU AI Act enforcement.` (send this **while standing on Subscriptions**) |
| 3.1 | `Sign me back in.` |
| 3.2 | `Read my library back to me.` |

For 1.3 the assistant needs to be able to run the fetcher on your machine. If your client cannot
run commands, run it yourself in the terminal scene and paste the JSON back — the video's claim
is *where* the fetch happens, not who typed it. Do not fake it the other way round: the fetch
must genuinely be local, because that is the sentence the voice-over says.

## 6. Things that will bite you on the day

- **Toasts expire.** They are the proof for several shots. Re-take rather than cutting to a
  shelf whose toast has already faded; a toast you have to explain is a toast the viewer missed.
- **A `replace` clears the topic's shelf.** `inject-news-to-feed` defaults to `mode: "replace"`,
  which drops that topic's earlier stories. If a take needs the previous batch still visible,
  ask for `append` explicitly.
- **Notes survive a replace, stories do not.** Useful if you want the Notes tab to look lived-in
  across resets.
- **Injecting from the Subscriptions tab redirects.** That is Shot 2.3's whole point — but it
  also means an unplanned injection during setup while on that tab lands somewhere you did not
  expect. Stand on Home while seeding.
- **`get-current-feed` never returns notes.** If your cut needs to show the omission, show the
  aside on the Notes tab that says so; do not expect the tool output to contain an empty
  `notes` key, because the key is not there at all.
- **Registration is per page load.** Reloading mid-take re-registers the tools; the count in the
  sidebar footer should stay at 11, and a lower number means something failed — check the
  console before continuing.
