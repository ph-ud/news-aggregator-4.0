# Repository Guidelines

## Project Structure & Module Organization

This repository is a WebMCP-powered reading library for the WebMCP Challenge. Keep the application organized by responsibility:

- `app.js` — frontend UI, view state, and page-exposed WebMCP tools.
- `src/crypto.js` — the end-to-end encryption primitives: key derivation, master-key wrapping, record encryption.
- `src/store.js` — the encrypted sync client: sign-in, sync, and the decrypted library the UI reads.
- `src/keystore.js` — persists the unwrapped master key across reloads as a non-extractable `CryptoKey`.
- `src/data.js` — normalization, URL validation, deduplication, and source metadata for stories and creators.
- `server/db.mjs` — SQLite schema. `server/auth.mjs` — password and session hashing. `server/api.mjs` — routes. `server/http.mjs` — request helpers.
- `server.mjs` — static file server plus the `/api` mount.
- `tests/` — crypto unit tests, API integration tests, and normalization tests for untrusted agent input.

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
- E2E in a browser does not defend against a malicious server serving hostile JavaScript. It defends against a leaked database, a stolen backup, and a curious operator.

## Content Security Policy

`server.mjs` serves a deny-by-default policy. This is not an anti-operator control — they write the policy — but an anti-XSS one, and XSS is the attack that walks straight through the encryption: the master key is a non-extractable `CryptoKey`, so injected script cannot steal the raw bytes, but it can still use the key to decrypt the library and post the plaintext out. Since the whole UI is built by concatenating agent-supplied text into `innerHTML`, one missed `escapeHtml` is a full compromise, and the policy is the backstop.

- **Never add an inline event handler or inline `<script>`.** `script-src 'self'` blocks both; the image fallback uses a delegated capture-phase `error` listener for this reason. A test asserts no inline handlers creep back in.
- `style-src` keeps `'unsafe-inline'` for style attributes such as `--reader-scale`; injected CSS is far less dangerous than injected script.
- `img-src` is wide on purpose: article images are chosen by the agent.
- `base-uri 'none'` matters more than it looks — without it an injected `<base>` retargets every relative module import.
- Subresource Integrity was considered and rejected: every script is same-origin so there is no third party to protect against, and `integrity` does not cover a module's static imports, so it would hash `app.js` while leaving `crypto.js` unprotected.

Making this policy meaningfully stronger means Trusted Types (`require-trusted-types-for 'script'`), which would route every `innerHTML` assignment through an explicit policy. That is a separate piece of work.

`tests/api.test.mjs` asserts that a full write leaves no plaintext in the database file or its write-ahead log, with a positive control so the test cannot pass by writing nothing.

## Deployment

The app is no longer a static site: it needs a Node process (≥22.5, for `node:sqlite`) and a persistent disk for the database. Vercel's static/serverless model does not fit — use a host that keeps a filesystem. Set `SESSION_SECRET` in production (the server refuses to start without it) and `DATABASE_PATH` to a persistent location. To move to Postgres, replace `server/db.mjs`; the SQL is deliberately plain.

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
