# Repository Guidelines

## Project Structure & Module Organization

This repository is a WebMCP-powered news aggregator for the WebMCP Challenge. Keep the application organized by responsibility:

- `app.js` — frontend UI, account session, library/discover state, and page-exposed WebMCP tools.
- `src/account.js` — local account creation, PBKDF2 passphrase hashing and verification, and per-account storage keys.
- `src/data.js` — normalization, URL validation, deduplication, and source metadata handling for both stories and creators.
- `server.mjs` — dependency-free static server and the headers required for local WebMCP testing.
- `tests/` — unit tests for untrusted agent-supplied article records.

Keep WebMCP handlers narrow, typed, and safe. ChatGPT searches the web; 4.0-reads only receives selected, structured records through `inject-news-to-feed` and `discover-creators`.

## Accounts

Reading data belongs to an account. Accounts are local to the browser: credentials live in `localStorage` under `4.0-reads-accounts-v1`, passphrases are stretched with PBKDF2-SHA-256 (150k iterations, per-account salt) and never stored in the clear, and each account's library is namespaced with `scopedKey(id, 'library')`. Every write path — saving a story, subscribing to a creator, and the WebMCP tools behind them — must call `requireAccount()` first, so an agent cannot fill a shelf that has no owner. `get-account-status` lets an agent check for a session before attempting a write; only the person at the keyboard can sign in.

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
