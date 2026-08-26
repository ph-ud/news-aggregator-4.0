# Repository Guidelines

## Project Structure & Module Organization

This repository is a WebMCP-powered news aggregator for the WebMCP Challenge. Keep the application organized by responsibility:

- `app.js` — frontend UI, feed state, and page-exposed WebMCP tools.
- `src/data.js` — normalization, URL validation, deduplication, and source metadata handling.
- `server.mjs` — dependency-free static server and the headers required for local WebMCP testing.
- `tests/` — unit tests for untrusted agent-supplied article records.

Keep WebMCP handlers narrow, typed, and safe. ChatGPT searches the web; Signal only receives selected, structured article records through `inject-news-to-feed`.

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
