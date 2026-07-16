# Repository Notes

## Commands

- Typecheck: `bun run typecheck`.
- Lint: `bun run lint`.
- Format check: `bun run format:check`.
- Format: `bun run format`.
- Test: `bun run test`.
- Run the TUI: `bun run start` (or `bun run tui`).
- Run the TUI against a deterministic offline mock (no network): `bun run tui:mock`.
- Run the CLI: `bun run cli --from JFK --to LHR --depart-date 2026-08-20`.
- Run the CLI in production mode (caching, rate limiting, retry): `bun run production --from JFK --to LHR --depart-date 2026-08-20`.

## Commit Readiness

- Before committing, run `bun run format:check`, `bun run typecheck`, `bun run lint`, and `bun run test`.
- If formatting fails, run `bun run format` (or `bunx oxfmt <files>` for just the touched files), then rerun `bun run format:check`.
- There is no CI configured yet — these checks are the only gate, so run them locally before every commit.

## Architecture

- `src/domain/` — validated request/response schemas and branded types (airport codes, dates, `ScrapeRequest`).
- `src/services/` — the `ScraperService` seam and its adapters: `scraper-protobuf` (real HTTP), `scraper-mock` (deterministic), `scraper-production` (caching + rate limiting middleware over another adapter). Also the Flights RPC transport (`google-rpc.ts`), search-page/flight parsing, multi-city picker, and booking-options lookup.
- `src/tui/` — the React + OpenTUI terminal UI. `useAppShell` is the one hook owning all TUI state and actions; `tui/keymap/` is a bindings-as-data keymap engine (vendored from [ghui](https://github.com/kitlangton/ghui), MIT) dispatched purely and shared by the footer hints and command palette.
- `src/cli.ts` / `src/cli/` — CLI entrypoint and argument parsing, wired to the same `ScraperService` seam.
- `src/utils/` — the `tfs` protobuf encoder and the sliding-window rate limiter.
- See [CONTEXT.md](CONTEXT.md) for the project's domain language (Search, Scraper, Result, Picker, Designator, etc.) — check it before introducing new terms for these concepts, and update it when the domain model changes.

## Conventions

- Effect v4: `Context.Service` + layers for services, `Effect.fn`-named operations, typed `ScraperError`s rather than throwing.
- Decode untrusted input against a `Schema` at the boundary (e.g. `ScrapeRequestSchema`) — airport codes and dates are branded types, not raw strings, past that boundary.
- No browser automation: the scraper talks to Google's Flights RPC and search-page HTML directly over HTTP.
- No semicolons, double quotes, trailing commas — enforced by `oxfmt` (`.oxfmtrc.json`), not manual style.
