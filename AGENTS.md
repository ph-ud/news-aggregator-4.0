# Repository Guidelines

## Project Structure & Module Organization

This repository is a WebMCP-powered reading library for the WebMCP Challenge. Keep the application organized by responsibility:

- `app.js` — frontend UI, view state, and page-exposed WebMCP tools.
- `src/crypto.js` — the end-to-end encryption primitives: key derivation, master-key wrapping, record encryption.
- `src/store.js` — the encrypted sync client: sign-in, sync, and the decrypted library the UI reads.
- `src/keystore.js` — persists the unwrapped master key across reloads as a non-extractable `CryptoKey`.
- `src/data.js` — normalization, URL validation, deduplication, and source metadata for stories and creators.
- `src/auth-tools.js` — the WebMCP login tools, kept out of `app.js` so their shape is testable without a browser.
- `src/credentials.js` — the browser password manager integration (Credential Management API).
- `src/passkeys.js` — passkey enrolment and unlock. `server/webauthn.mjs` — assertion verification.
- `server/db.mjs` — SQLite schema. `server/auth.mjs` — password and session hashing. `server/api.mjs` — routes. `server/http.mjs` — request helpers.
- `server.mjs` — static file server plus the `/api` mount.
- `tests/` — crypto unit tests, API integration tests, login-tool tests, passkey and WebAuthn verification tests, and normalization tests for untrusted agent input.

Keep WebMCP handlers narrow, typed, and safe. ChatGPT searches the web; 4.0-reads only receives selected, structured records through `inject-news-to-feed` and `discover-creators`.

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

## News Freshness

Search quickly and favor reliable primary reporting from the last 24–48 hours. Verify the original publication time, not the search-index date. Do not include month-old articles; use stories older than seven days only when they provide necessary context. Keep each briefing concise, source-diverse, deduplicated, and responsive to the exact question.
