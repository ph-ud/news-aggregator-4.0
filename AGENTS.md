# Repository Guidelines

## Project Structure & Module Organization

This repository is a WebMCP-powered reading library for the WebMCP Challenge. Keep the application organized by responsibility:

- `app.js` — frontend UI, view state, and page-exposed WebMCP tools.
- `src/crypto.js` — the end-to-end encryption primitives: key derivation, master-key wrapping, record encryption.
- `src/store.js` — the encrypted sync client: sign-in, sync, and the decrypted library the UI reads.
- `src/keystore.js` — persists the unwrapped master key across reloads as a non-extractable `CryptoKey`.
- `src/data.js` — normalization, URL validation, deduplication, provenance, and note helpers.
- `src/rss.js` — the feed parser (RSS 2.0, Atom, RDF). Pure; it runs in the fetcher script, never in the page.
- `bin/rss-fetch.mjs` — the local feed fetcher an agent runs on the reader's machine.
- `src/auth-tools.js` — the WebMCP login tools, kept out of `app.js` so their shape is testable without a browser.
- `src/credentials.js` — the browser password manager integration (Credential Management API).
- `src/passkeys.js` — passkey enrolment and unlock. `server/webauthn.mjs` — assertion verification.
- `server/db.mjs` — SQLite schema. `server/auth.mjs` — password and session hashing. `server/api.mjs` — routes. `server/http.mjs` — request helpers.
- `server.mjs` — static file server plus the `/api` mount.
- `tests/` — crypto unit tests, API integration tests, login-tool tests, passkey and WebAuthn verification tests, and normalization tests for untrusted agent input.

Keep WebMCP handlers narrow, typed, and safe. ChatGPT searches the web; 4.0-reads only receives selected, structured records through `inject-news-to-feed` and `deliver-rss-items`.

## Two Pipelines, One Shelf

The library is an RSS reader with an assistant attached, not the other way round. Subscriptions
are the baseline: a feed the reader subscribed to delivers the publisher's own entries. The AI
tools are the discovery layer on top — they find authors worth following and research stories on
a topic, and what they deliver is a model's prose about reporting this app has never fetched.

Every story therefore carries `via`, either `rss` or `ai`, and the distinction is enforced rather
than advisory:

- **`via` is stamped by the normalizer, never read from the payload.** `normalizeStories`
  hard-codes `ai`, `normalizeFeedItems` hard-codes `rss`, and neither tool schema exposes the
  field — both set `additionalProperties: false` so it cannot ride along with the real ones. A
  caller that could set its own `via` could label an invented story as syndicated reporting,
  which is exactly the claim the badge exists to make trustworthy.
- **An entry is `rss` only under a feed the reader subscribed to.** `subscriptionForFeed` matches
  on host plus path, so neither a query string nor a sibling page on a subscribed domain passes.
  A feed nobody subscribed to is **refused, not relabelled**: quietly storing it as `ai` would
  turn a rejected claim into an accepted one under another name.
- **The wording differs because the truth differs.** `provenanceLabel` says "Added by ChatGPT"
  over a model's summary and "From X's feed" over a publisher's own entry, and the reader page
  swaps its notice and its source notes to match. Telling a reader that a publisher's syndicated
  post was written by an assistant is the same class of error as passing a summary off as the
  article.
- **A `replace` never crosses the line.** `staleStoriesForReplace` only considers `ai` stories,
  or an AI refresh on a topic sharing a subscription's name would clear a shelf the reader
  subscribed to.
- **One link, one card.** `withoutFeedDuplicates` drops an incoming AI story whose URL a
  subscription already delivered; the publisher's own entry wins over a summary of it.
- Records stored before `via` existed default to `ai`, which is what they were.

## The Tabs

The left column is three shelves over one library, and which shelf a story lands on follows
from its `via` rather than from where the reader happened to be standing:

- **Home** is both pipelines in one timeline, ordered by **publication date** — not arrival.
  Arrival order clumps it: a fetch drops a subscription's backlog in at once and an injection
  drops a topic's batch in at once, so the shelf would read as blocks of one origin then the
  other. Publication date is also the only date the two pipelines share a meaning for; a feed
  entry fetched today may be a week old and belongs where a week-old story belongs.
  `sortStoriesByDate` is that ordering, and `addedAt` breaks ties so undated entries do not
  shuffle between renders.
- **Subscriptions** reads from feeds and nothing else. This is the definition of the tab, not a
  filter that happens to exclude AI stories today.
- **AI finds** is its exact complement, so no story can fall between the two.

**An injection while the reader is on Subscriptions goes to AI finds.** An assistant researching
a topic must not put a model's summary in among posts from people the reader chose to follow —
that is the whole claim the tab makes. The stories are still stored; only the destination
changes, and the toast says where they went. `deliverFeedItems` is the mirror image: entries
arriving while the reader is on AI finds move them to Subscriptions rather than reporting
entries they cannot see.

Neither redirect may be silent, and neither may be dropped. "It should not appear here" always
means *it appears on its own tab*, never *it is discarded*.

## Subscriptions Live in Settings, and There Is No Third Entity

A reader is subscribed to a source or they are not. There used to be a middle state — a
"creator", researched by an assistant and parked on a Discover page until the reader pressed
Subscribe — and it was a second record for the same fact, carrying a `feedUrl` that did nothing
until it became a subscription. It is gone, along with `discover-creators` and the Discover tab.

- **Suggestions belong in the conversation, not in a staging area.** An assistant that has found
  sources worth following names them to the reader and calls `subscribe-to-source` for the ones
  they ask for. The consent step did not disappear with the Subscribe button; it moved to where
  the reader already is. `subscribe-to-source` says so, and says not to subscribe unprompted.
- **Managing subscriptions is not reading.** The left column is Home, Subscriptions and AI finds
  — three ways to read a shelf. A list of feeds to administer is a different job, so it lives in
  the settings dialog, which also holds reading preferences and the account. Mixing them made the
  column half navigation and half control panel.
- **The dialog is rendered by `render()` like any other view**, so it passes through the one
  guarded sink rather than being appended as a detached node. Nothing in it holds text the reader
  is mid-way through typing, because a repaint rebuilds it.

## Read State and Counts

- **Every badge counts unread, never a total.** A total is something the reader can see by
  looking at the shelf; what they want to know is how much is waiting. Zero unread renders no
  badge at all, as a badge should.
- **`readAt` lives on the story**, not in a record of its own. A `replace` that drops a story
  takes its read state with it, where a separate marker would survive and count toward a badge
  for something no longer on any shelf.
- **Marking read does not re-render.** The reader page has no sidebar, so no badge on screen is
  stale, and a repaint would rebuild the note editor underneath the reader. The write is
  fire-and-forget: a failed one must never stop someone reading.
- **Read stories recede; they do not disappear.** Dimmed title, summary and cover, and the unread
  dot withheld. Keep it gentle — a shelf where read stories have visibly settled back is the
  point, but a feed that shouts about three unread items is worse than one that says nothing.

## Notes

A note is the only text in this library the reader wrote themselves. Everything else is a
publisher's or a model's, which is why the provenance rules exist; a note needs no such hedging,
and it is the one record whose loss cannot be repaired by fetching anything again.

- **No assistant reads them.** `get-current-feed` destructures `notes` out before returning, and
  no tool ships that reads them back. A broad "read the library" call is not consent to hand over
  the reader's private annotations, and adding one would need to be a deliberate decision with
  its own tool and its own description saying what it exposes.
- **Autosave must never re-render.** The editor is a live `<textarea>`; `paint()` rebuilds the
  entire view, so a render mid-sentence takes the caret and the scroll position with it. The
  input handler debounces the write and updates the status line in place — the same rule the
  passphrase form follows, for the same reason. A test asserts no `render()` in that path.
- **Blur flushes the pending write.** Clicking Back blurs the textarea first, so the `change`
  handler saves immediately rather than letting the debounce timer lose the last sentence.
- **Emptying the box deletes the note**, so there is no way to accumulate blank records.
- **A note outlives its story.** `inject-news-to-feed` with `mode: 'replace'` drops stories the
  new batch did not carry, and deleting a reader's own words as a side effect of refreshing a
  shelf would be indefensible. Each note stores the article's title, source, and link when it is
  written, so an orphaned note still says what it was about and links where it pointed.

## Fetching Feeds Without a Server

A desktop reader polls feeds locally and nothing about the reader's subscriptions leaves their
computer. This app gets the same property a different way, because a web page cannot do what
NetNewsWire does:

- **A page cannot fetch a feed.** Reading `https://someblog.example/feed.xml` from our origin
  needs `Access-Control-Allow-Origin` on the feed, and almost no feed sends one; `no-cors` returns
  an opaque response nothing can parse. This is why every hosted reader — Feedly, Inoreader,
  NewsBlur — fetches server-side. It is a browser rule, not something this codebase can route
  around, and widening `connect-src` would not fix it while opening the exfiltration path the
  CSP exists to close.
- **A fetcher on our server was rejected.** It works, but the server would learn exactly which
  publications each account follows — the one fact the record encryption is designed to withhold,
  and the same leak as the `creator-<host>` record id that rule already forbids.
- **So the fetch runs on the reader's machine.** `bin/rss-fetch.mjs` takes the feed URLs from
  `list-subscription-feeds`, fetches and parses them locally, and prints one ready-made
  `deliver-rss-items` argument object per feed. An agent runs it and hands the result back. The
  server sees ciphertext, as it does for everything else, and `connect-src 'self'` is untouched.
- **Feed text is untrusted input like any other.** `src/rss.js` extracts strings and evaluates
  nothing; `normalizeFeedItems` then trims, validates URLs, and strips markup, exactly as the
  agent-facing normalizers do. `source` and `feedUrl` come from the *subscription*, never from
  the payload, so a delivery cannot attribute an entry to a publication the reader never followed.
- **A subscription with no feed is kept, not refused.** A story card knows an article's host and
  nothing else, and who to follow is the reader's decision — the part only they can make. Such a
  subscription is `pending`, shows as "no feed", delivers nothing, and an assistant can fill in
  the feed later with `attach-feed-url`.
- **Unsubscribing leaves delivered stories on the shelf.** They were read, saved, and filed like
  any others; deleting them would be a surprise rather than a cleanup.

## Accounts and Encryption

Reading data belongs to an account and is end-to-end encrypted. **The server cannot read any of it, and neither can we.**

One passphrase derives two independent secrets client-side, using domain-separated salts:

- `authKey = PBKDF2(passphrase, salt‖"auth", 600k)` is sent to the server, which stores `scrypt(authKey)`. A database dump yields neither the passphrase nor a replayable credential.
- `kek = PBKDF2(passphrase, salt‖"enc", 600k)` never leaves the browser. It wraps a random 256-bit master key; the server stores only the wrapped blob.

Every library record is encrypted with AES-GCM under the master key, with a fresh IV per write. The master key indirection means changing a passphrase re-wraps one blob instead of re-encrypting the library.

Rules that keep this real rather than nominal:

- **Never derive a record id from its content.** A `creator-<host>` id would leak subscriptions to the server even with the payload encrypted. Use `randomId()`.
- **The record type lives inside the ciphertext**, not in a column, so a dump cannot separate saved stories from subscriptions.
- **The server cannot validate content it cannot read.** Normalization stays client-side; the server enforces only structural limits (record size, count, batch size).
- **What a dump still reveals:** email, display name, record count, ciphertext sizes, and write timestamps. Do not add plaintext columns beyond these without deciding that the leak is acceptable.
- **A forgotten passphrase cannot be reset.** The recovery key shown once at sign-up is the only fallback, and it is base32 so the written-down form converts back losslessly.
- **The recovery key derives from its own salt and iteration count**, never from `kdf_salt`. Changing a passphrase rotates `kdf_salt`, so sharing it would silently invalidate the recovery key and lock the reader out permanently the next time they forgot their passphrase. `POST /api/auth/rekey` must leave every `recovery_*` column untouched.

## Login Tools

An agent may *ask* for a sign-in; it must never *perform* one. `start-sign-in` and `sign-out` in
`src/auth-tools.js` are a handoff: they put the right form in front of the person at the keyboard
and wait, and the reader types their own passphrase into the page.

- **No login tool may accept a passphrase, a recovery key, or any other credential.** The
  passphrase derives the key that decrypts the library; routed through a tool call it would be
  read by a model, written to a transcript, and probably logged — the encryption would be
  decorative. Every schema sets `additionalProperties: false` so the field cannot be smuggled in
  anyway, and a test asserts both.
- **Prefill only what the server already knows.** An email and a display name are in the database
  in plaintext, so filling them in gives nothing away. They are still agent-supplied strings:
  trim, cap, and let the `html` template escape them.
- **Nothing writes while the recovery key is on screen.** It is shown exactly once, and any
  repaint destroys the only fallback for a forgotten passphrase — so `requireAccount()` refuses
  every write until the reader has confirmed it, and `start-sign-in` does not hand control back
  to the agent until then either. A sign-up that returned at `signedIn` would let the agent's
  very next call take the key off the screen.
- **`start-sign-in` waits, but not forever.** It polls until the reader finishes and otherwise
  returns `waiting: true` after three minutes, so an assistant that was called speculatively
  cannot hang on a form nobody is looking at.
- **Neither tool runs during a re-key**, for the same reason the UI blocks navigation: the
  passphrase form is what reports a failure.
- **Never repaint over the forced-passphrase step.** After a recovery, `start-sign-in` reports the
  state and leaves the page alone.
- Signing out is not undoable from a tool — only the reader's passphrase opens the library again —
  so the description tells the agent to call it when asked, not on its own initiative.

## The Browser's Password Manager

ChatGPT Atlas is Chromium with its own password store, and it imports the reader's existing
passwords on setup. Agent mode is documented as having no access to saved passwords or autofill.
That makes the password manager the one component in an agentic browser that can put a passphrase
into this page without the agent seeing it — so the sign-in is built around it rather than around
typing. `src/credentials.js` holds the integration.

- **The email field is the username field.** `autocomplete="username"` next to
  `current-password` (and `new-password` on sign-up) is what makes a Chromium password manager
  recognize the form at all. `autocomplete="email"` is not a substitute.
- **Offer the credential after every success — sign-in, sign-up, and re-key.** A saved passphrase
  that is one re-key out of date is worse than none: autofill would quietly stop unlocking the
  library, and the reader would blame the app. `navigator.credentials.store()` is what teaches
  the manager, because a page that never navigates gets no save prompt of its own.
- **Never retrieve a credential without the reader asking.** Retrieval runs from their click,
  with `mediation: 'optional'` so the chooser stays browser UI the page cannot script. A silent
  `get()` on load would hand an unlocked library to anything that can open the page — an agent
  included — which is precisely the thing the rest of this design refuses to do.
- **`preventSilentAccess()` on sign-out**, or signing out means nothing on a shared or
  agent-driven browser. The `sign-out` tool calls the application's own sign-out for this reason:
  a second implementation is how that step silently goes missing.
- **Every call is best-effort and must never break a sign-in.** `window.PasswordCredential`
  existing does not mean a store is reachable — headless and embedded Chromium reject `get()`,
  `store()`, and `preventSilentAccess()` with `NotSupportedError`. A credential with no password
  (a federated or passkey entry) is equally a miss. Every failure means one thing: the reader
  types their passphrase, exactly as before.
- **What this changes about the threat model:** the passphrase now also lives in the reader's
  password manager, which their browser vendor may sync. That is their choice and the same
  posture as every other site they save; it is still not on our server, which is what the
  end-to-end claim is about. Do not let it drift further — never send the passphrase anywhere,
  and never put it in a tool result.

## Passkeys

A passkey is the one credential an agentic browser cannot use on the reader's behalf: unlocking
requires user verification — a fingerprint, a face, a device PIN — and the secret that decrypts
the library is computed inside the authenticator. The WebAuthn PRF extension is what makes it an
encryption story rather than only a sign-in one.

- **A passkey is a third wrapper around the same master key**, exactly like the recovery key. It
  re-encrypts nothing, and enrolling or removing one leaves the library and every other way in
  untouched. `POST /api/auth/rekey` must keep leaving the `passkeys` table alone.
- **Enrolling needs the passphrase**, because the raw master key is only obtainable by unwrapping
  it — after a reload the in-memory key is a non-extractable `CryptoKey`. `store.rawMasterKey()`
  is that one verified path, shared with the re-key.
- **The PRF salt is a constant.** PRF already yields a distinct secret per credential, and a
  per-passkey salt would have to be fetched before the assertion — the exact lookup a
  discoverable credential exists to avoid. The output is run through HKDF with its own info
  string, so the same secret used for something else later cannot collide with the wrapping key.
- **`residentKey: 'required'` and `userVerification: 'required'` are both load-bearing.**
  Discoverable is what lets the reader unlock without typing an email; verified is the gesture
  an agent cannot make. The server rejects an assertion whose UV flag is clear, so a relaxed
  client cannot quietly downgrade it.
- **No attestation, and therefore no CBOR.** Registration happens inside an authenticated
  session and asks for `attestation: 'none'`, so the browser's own `getPublicKey()` is the public
  key of record. Attestation answers "which authenticator model is this", a question this app
  does not ask, and parsing it would mean a CBOR decoder in the server.
- **What the server verifies on every assertion**, all of it in `server/webauthn.mjs`: a
  single-use challenge it issued and deletes on read, the client-data type (a registration
  signature must not replay as a sign-in), the origin, the RP id hash, the UV flag, the
  signature, and a counter that must not go backwards. A counter of zero on both sides is normal
  — many authenticators keep none — and is not treated as a clone.
- **Behind a proxy, set `ORIGIN`.** The relying party is derived from the `Host` header
  otherwise, and a deployment that terminates TLS elsewhere cannot trust it. `RP_ID` overrides
  the id alone.
- **A failed unlock never leaves a half-open library.** The wrapper is opened client-side, so a
  server that returns the wrong blob produces a refusal, not a session with no key.

## Changing a Passphrase

Changing a passphrase re-wraps the master key; it never re-encrypts the library and never changes the master key, so stored records and the recovery key are both unaffected.

The current passphrase is **required** and is verified by actually unwrapping the master key rather than by asking the server, so a compromised server cannot wave the check through. It is also the only way to obtain the raw key bytes at all: after a reload the in-memory key is a non-extractable `CryptoKey`, deliberately impossible to read back. The single exception is the moment just after recovery, when the raw key is still in hand from the recovery unwrap and there is no current passphrase to give — `store.pendingRaw` holds it for exactly that step, and the UI forces a new passphrase before anything else is reachable.

Two UI rules that are easy to break:

- **Never re-render the passphrase form to show an error.** Passphrases cannot be echoed into HTML attributes, so a re-render clears all three fields and forces the reader to retype everything. `setPassphraseFormState` updates the message in place.
- **Block navigation while a re-key is in flight.** The form is what reports a failure; if the reader signs out mid-operation, a security-critical change fails with nowhere to report it.

Re-keying deletes every session for the account server-side, so other devices must sign in again with the new passphrase.
- E2E in a browser does not defend against a malicious server serving hostile JavaScript. It defends against a leaked database, a stolen backup, and a curious operator.

## Content Security Policy

`server.mjs` serves a deny-by-default policy. This is not an anti-operator control — they write the policy — but an anti-XSS one, and XSS is the attack that walks straight through the encryption: the master key is a non-extractable `CryptoKey`, so injected script cannot steal the raw bytes, but it can still use the key to decrypt the library and post the plaintext out. Since the whole UI is built by concatenating agent-supplied text into `innerHTML`, one missed `escapeHtml` is a full compromise, and the policy is the backstop.

- **Never add an inline event handler or inline `<script>`.** `script-src 'self'` blocks both; the image fallback uses a delegated capture-phase `error` listener for this reason. A test asserts no inline handlers creep back in.
- `style-src` keeps `'unsafe-inline'` for style attributes such as `--reader-scale`; injected CSS is far less dangerous than injected script.
- `img-src` is wide on purpose: article images are chosen by the agent.
- `base-uri 'none'` matters more than it looks — without it an injected `<base>` retargets every relative module import.
- Subresource Integrity was considered and rejected: every script is same-origin so there is no third party to protect against, and `integrity` does not cover a module's static imports, so it would hash `app.js` while leaving `crypto.js` unprotected.

## Trusted Types

`require-trusted-types-for 'script'` makes every `innerHTML` assignment a `TypeError` unless the value comes from a registered policy, and `trusted-types reads-views` allows exactly one policy name so injected script cannot register a permissive one of its own.

The policy is **not** a pass-through. `createHTML(value, source)` verifies that the string was produced by the `html` template in `src/html.js`, which escapes every interpolation by construction. A policy of the shape `createHTML: (s) => s` would satisfy the CSP while protecting nothing; a test asserts ours checks provenance.

Rules for writing views:

- **Build every view with the `html` tagged template**, and return `SafeHtml`. `paint()` is the only sink in the application and rejects anything else.
- **Never call `escapeHtml` in a view.** The tag already escapes; doing both double-escapes and shows `&amp;lt;` to the reader. A test asserts no view calls it.
- **A quoted string containing markup will be escaped, not rendered.** This is the easy mistake: `${cond ? '<p>hi</p>' : ''}` renders the tags as text. Use `html\`<p>hi</p>\`` for both branches.
- **`raw()` is the escape hatch and is only for markup we wrote ourselves** — `icon()` uses it. Never pass it anything derived from a record, a tool argument, or any other agent-supplied value.
- **`false` serializes to nothing**, so that `${cond && html\`...\`}` works. Boolean attributes therefore need `${String(value)}`, or `aria-pressed` silently becomes `""`.
- Arrays of `SafeHtml` serialize themselves; no `.join('')` needed.

Trusted Types is defence in depth rather than the primary control: with `script-src 'self'` already blocking inline handlers, injected `<script>`, and `javascript:` URLs, most DOM-XSS paths are shut before this. What it adds is structural — unescaped interpolation becomes impossible to write, and the sink set stays auditable.

`tests/api.test.mjs` asserts that a full write leaves no plaintext in the database file or its write-ahead log, with a positive control so the test cannot pass by writing nothing.

## Deployment

The app is no longer a static site: it needs a Node process (≥22.5, for `node:sqlite`) and a persistent disk for the database. Vercel's static/serverless model does not fit — use a host that keeps a filesystem. Set `SESSION_SECRET` in production (the server refuses to start without it), `DATABASE_PATH` to a persistent location, and `ORIGIN` to the site's own origin so passkey verification does not depend on the `Host` header. To move to Postgres, replace `server/db.mjs`; the SQL is deliberately plain.

## Build, Test, and Development Commands

Once the JavaScript toolchain is added, document the exact package-manager commands in `package.json`. The expected workflow is:

- `npm install` — install dependencies.
- `npm run dev` — start the local development server.
- `npm run build` — create a production build.
- `npm test` — run the full test suite.
- `npm run lint` — check formatting and static analysis.

Use the repository’s declared package manager and lockfile; do not mix npm, pnpm, and yarn lockfiles.

## Coding Style & Naming Conventions

Use TypeScript where practical, two-space indentation, semicolons, and single-quoted strings. Name components and types in `PascalCase`, functions and variables in `camelCase`, and WebMCP tool names in kebab-case (for example, `inject-news-to-feed`). Keep API keys in environment variables, never source files.

## Testing Guidelines

Test normalization, deduplication, source attribution, and WebMCP input validation. Use names such as `news-normalizer.test.ts` and `webmcp-tools.test.ts`. Every feed mutation should have an integration test covering both the tool response and visible feed state.

## Commit & Pull Request Guidelines

There is no commit history yet, so use concise imperative subjects such as `Add WebMCP news search tool`. Pull requests should explain user impact, include test commands and results, link the relevant issue or challenge requirement, and attach screenshots or a short recording for UI changes. Call out any new permissions, external APIs, or configuration variables.

## Security & Source Quality

Treat article content and WebMCP tool arguments as untrusted input. Sanitize rendered content, validate URLs, preserve source links and timestamps, and never silently publish a story without showing its provenance. Tool descriptions must state that the app does not fetch or open user-supplied links.

## Provenance

No article page is ever fetched. Two things reach the shelf: a subscription's entries, which are
the publisher's own syndicated text, and an assistant's research, whose prose — the summaries we
display — is the model's, not the publisher's. In both cases the link, source name, and
publication date point at real reporting, and in neither case do we hold the article itself.

That makes attribution a correctness requirement, not a courtesy:

- **Every view that renders agent-written prose renders `provenanceTag()` beside it.** `addedByLabel()` in `src/data.js` supplies the wording and falls back to "an assistant" for records stored before the field existed, so a card can never read as the publisher's own. A test asserts each card view calls it.
- **The reader page must never present the summary as the article.** It carries `.article-notice` saying so in as many words, and its dek names the assistant and the date the record was added — not the publication date, which belongs to the reporting.
- **Never state a fact about text we do not hold.** The reader page shows the summary's word count; the "12 min read" it used to show was a claim about an article the app has never seen. A test keeps both that string and the old dek from returning.
- **Feed entries are the exception, and they say so.** A subscription's entries are the
  publisher's own syndicated text, so `provenanceLabel` credits the publication rather than an
  assistant and the reader page drops the "written by an assistant" notice for one saying this
  is the feed entry as published. What stays true for both: the app never fetches the article
  *page*, and never claims to hold text it does not have.
- A subscription's `feedUrl` is load-bearing: it is what makes the subscription deliver anything.
  Nothing in the page fetches it even so — the fetch happens on the reader's machine, and
  `connect-src 'self'` still exists so decrypted content cannot leave the page.

## Story Quality

### Summary Depth

The summary is not a teaser. The app never fetches the article, so what an assistant writes is the whole of what a reader gets unless they leave for the source — a one-line restatement of the headline gives them a shelf of stories they cannot read.

`inject-news-to-feed` therefore asks for 4–6 sentences (roughly 80–150 words) and marks `summary` required, and `SUMMARY_LIMIT` in `src/data.js` keeps 1200 characters so a full answer survives storage. Keep those two numbers in agreement: advertising a length the normalizer then truncates is worse than asking for less. A test asserts the schema's `maxLength` is the same constant the normalizer enforces.

Normalization stays lenient where the schema is strict — a story that arrives without a summary gets a placeholder rather than being dropped, because a reader is better served by a link they can follow than by silence.

### News Freshness

Search quickly and favor reliable primary reporting from the last 24–48 hours. Verify the original publication time, not the search-index date. Do not include month-old articles; use stories older than seven days only when they provide necessary context. Keep each briefing concise, source-diverse, deduplicated, and responsive to the exact question.
