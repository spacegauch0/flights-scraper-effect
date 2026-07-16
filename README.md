# ✈️ Google Flights Scraper (Effect + Protocol Buffers)

A Google Flights scraper built with **TypeScript Effect v4** and **Protocol Buffers** — no browser required — with a keyboard-driven terminal UI built on **React + OpenTUI**. Inspired by [fast-flights](https://github.com/AWeirdDev/flights).

```
 ✈ flights  JFK → LHR  ·  one-way · economy · 1 pax
 ──────────────────────────────────────────────────────────────────────────────────────────
 ╭─ search ─────────────────────╮  10 flights                                prices typical
 │                              │
 │ Route                        │  AIRLINE               │ DEPARTURE│ ARRIVAL     │ DURATION│ STOPS  │ PRICE ▲
 │ JFK    → LHR                 │  Iberia                │ Thu 13:25│ Fri 04:55 +1│ 15h 30m │ 2 stops│    $146
 │                              │  United                │ Thu 21:20│ Fri 07:35 +1│ 10h 15m │ 1 stop │    $147
 │ Trip                         │  ⭐ Air France         │ Thu 20:25│ Fri 07:55 +1│ 11h 30m │ 1 stop │    $267
 │  ▶ One-way                   │  Delta                 │ Thu 18:15│ Fri 12:25 +1│ 18h 10m │ 1 stop │    $294
 │    Round-trip                │  Norse Atlantic        │ Thu 18:00│ Fri 06:00 +1│ 12h     │ Nonstop│    $415
 │    Multi-city                │  ...                   │          │             │         │        │
 │                              │
 │ Depart                       │  ▸ Air France · Thu 20:25 → Fri 07:55 +1 · 1 stop · $267
 │ 2026-01-25                   │
 ╰──────────────────────────────╯
 ──────────────────────────────────────────────────────────────────────────────────────────
 ↑↓ rows │ ←→ cols │ space sort │ enter open flight │ g g top │ ctrl+p commands │ esc form
```

## 🚀 Features

### Core Capabilities
- ✅ **One-way, Round-trip, Multi-city flights** — multi-city works by chaining Google's own leg-by-leg shopping endpoint
- ✅ **Booking options lookup** — resolves the "Book with X" providers (and their prices) for a specific flight, no browser
- ✅ **All cabin classes** (Economy, Premium Economy, Business, First)
- ✅ **Multiple passengers** (Adults, Children, Infants in seat/on lap)
- ✅ **Advanced filtering** (Price, Duration, Airlines, Stops)
- ✅ **Flexible sorting** (Price, Duration, Airline)
- ✅ **Price indicator** (Low/Typical/High)

### Production Features 🎯
- ✅ **Response caching** via `effect/Cache` (15 min TTL, keyed by every search parameter, concurrent-request dedupe, failures never cached)
- ✅ **Rate limiting** (10 req/min sliding window with atomic slot reservation)
- ✅ **Transient retry** via `HttpClient.retryTransient` (jittered exponential backoff on timeouts/429/5xx)
- ✅ **HTTP status classification** — a 429 or consent page is a typed error, never an empty result

### Technical Highlights
- ⚡ **HTTP requests, not browser automation** — the `tfs` protobuf parameter is encoded directly
- 🔒 **Type-safe end to end** — searches are validated `ScrapeRequest` values with branded airport codes and dates; failures are typed `ScraperError`s
- 🧩 **Effect v4 architecture** — `Context.Service` + layers, `Effect.fn`-named operations, swappable scraper implementations (protobuf / production / deterministic mock)
- ⌨️ **Keymap-as-data TUI** — bindings are values with `when`/`enabled` gates and palette metadata (engine vendored from [ghui](https://github.com/kitlangton/ghui), MIT)

## 📦 Installation

```bash
bun install
```

Requires [Bun](https://bun.sh/).

## 🎯 Quick Start

```bash
# Interactive TUI (default with no arguments)
bun run start

# TUI against a deterministic offline mock — instant, no Google traffic
bun run tui:mock

# CLI
bun run cli --from JFK --to LHR --depart-date 2026-08-20

# CLI production mode (caching, rate limiting, retry)
bun run production --from JFK --to LHR --depart-date 2026-08-20
```

### Using as a Library

Searches are a single validated request. Decode untrusted input against `ScrapeRequestSchema` at the boundary — airport codes and dates are branded types, so an unvalidated string can't reach the scraper:

```typescript
import { Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { ScraperService, ScraperProtobufLive, ScrapeRequestSchema } from "./src"

const program = Effect.gen(function* () {
  const request = yield* Schema.decodeUnknownEffect(ScrapeRequestSchema)({
    from: "JFK",
    to: "LHR",
    departDate: "2026-08-20",
    tripType: "one-way",
    sortOption: "price-asc",
    filters: { limit: 10, max_stops: 1 },
    seat: "economy",
    passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
    currency: "USD"
  })

  const scraper = yield* ScraperService
  const result = yield* scraper.scrape(request)

  console.log(`Found ${result.flights.length} flights`)
  console.log(`Price level: ${result.current_price}`)
})

Effect.runPromise(program.pipe(
  Effect.provide(ScraperProtobufLive.pipe(Layer.provide(FetchHttpClient.layer)))
))
```

Layers to choose from:

| Layer | What it does |
|---|---|
| `ScraperProtobufLive` | Plain HTTP scraping (needs an `HttpClient` layer, e.g. `FetchHttpClient.layer`) |
| `ScraperProductionLive` | Adds caching, rate limiting, and transient retry (also needs `RateLimiterLive(...)`) |
| `ScraperMockLive` | Deterministic offline flights, seeded per route — for tests and UI work |

## 📁 Project Structure

```
src/
├── cli.ts                # Entry point (routes to CLI or TUI)
├── index.ts              # Library exports
├── domain/               # Schemas, branded types, typed errors
│   ├── types.ts          # ScrapeRequest, FlightOption, Result, filters…
│   └── errors.ts         # ScraperError
├── services/
│   ├── scraper.ts        # ScraperService interface (Context.Service)
│   ├── scraper-protobuf.ts    # HTTP implementation
│   ├── scraper-production.ts  # + effect/Cache, rate limit, retryTransient
│   ├── scraper-mock.ts        # Deterministic offline implementation
│   ├── flight-parsing.ts      # HTML parsing, filtering, sorting
│   ├── search-page.ts         # Shared search-page fetch
│   ├── multi-city.ts          # Leg-by-leg GetShoppingResults chain
│   └── booking-options.ts     # "Book with X" provider lookup
├── utils/
│   ├── protobuf.ts       # tfs parameter encoding
│   └── rate-limiter.ts   # Sliding-window rate limiter service
└── tui/                  # React + OpenTUI terminal interface
    ├── index.tsx         # runTui entry (renderer + ManagedRuntime)
    ├── app/              # useAppShell (state/actions) + pure components
    ├── keymap/           # Vendored keymap engine (bindings as data)
    ├── keymaps.ts        # Form/table/palette bindings
    ├── hints.ts          # Contextual footer hints
    └── format.ts         # Semantic colors, columns, formatters
test/                     # bun test: keymap, hints, formats + full-app
                          # frame tests on OpenTUI's in-memory renderer
```

## 🖥️ Terminal User Interface

Built with [OpenTUI](https://github.com/anomalyco/opentui)'s React renderer. All state lives in one shell hook; every keyboard action is a data-described binding, which also powers the command palette and the contextual footer hints.

**Features:**
- Departure-board results: fixed-width 24h times, colored stops, price-level verdict, whole-row selection
- `ctrl+p` command palette — filterable, lists each mode's commands with their keys; unavailable commands show *why*
- Interactive multi-city: pick each leg from real options, exactly like Google's wizard
- Opens the cheapest "Book with X" provider link for the selected flight in your browser
- Mock mode (`bun run tui:mock`) for instant offline iteration

**Keys (form):** `enter` search · `tab`/`shift+tab` fields · `ctrl+r` results · `ctrl+a`/`ctrl+x` add/drop leg (multi-city) · `ctrl+p` commands · `ctrl+c` quit

**Keys (results):** `↑↓`/`j k` rows · `←→`/`h l` columns · `g g`/`G` first/last · `space`/`s` sort · `enter`/`o` open or choose leg · `esc`/`q`/`tab` back

## 🔧 CLI Reference

**Required:** `--from/-f`, `--to/-t`, `--depart-date/-d` (YYYY-MM-DD)

**Optional:**
- `--return-date, -r <date>` · `--trip-type <one-way|round-trip|multi-city>`
- `--sort, -s <price-asc|price-desc|duration-asc|duration-desc|airline|none>` (default: `price-asc`)
- `--seat <economy|premium-economy|business|first>` · `--adults/-a`, `--children/-c`, `--infants-in-seat`, `--infants-on-lap`
- `--max-price`, `--min-price`, `--max-duration <minutes>`, `--max-stops <0|1|2>`, `--nonstop-only`, `--airlines <list>`
- `--limit, -l <number|all>` (default: 10) · `--currency <code>`
- `--production, -p` · `--json, -j` · `--help, -h`

Invalid input fails fast with the schema's message (airport codes must be 3-letter IATA, dates `YYYY-MM-DD`).

## 📊 Output Format

```typescript
{
  current_price?: "low" | "typical" | "high",
  flights: [
    {
      is_best?: boolean,
      name: string,                 // Airline name
      departure: string,            // "8:20 AM on Wed, Jan 14"
      arrival: string,
      arrival_time_ahead?: string,  // "+1" if next day
      duration: string,             // "12 hr 30 min"
      stops: number,
      delay?: string,
      price: string,                // "$481"
      deep_link?: string,           // Google Flights booking URL when found
      flight_number?: string        // e.g. "BA178" - used for booking lookup
    }
  ]
}
```

## 🧪 Development

```bash
bun run typecheck   # tsc --noEmit
bun run test        # 26 tests: keymap dispatch, hints, formatters, and
                    # full-app TUI frame tests (in-memory renderer + mock keys)
bun run tui:mock    # develop the TUI offline against deterministic data
```

## 📚 Tech Stack

- **[Effect v4](https://effect.website/)** — services/layers, Schema (built into core), Cache, typed errors, `HttpClient`
- **[React 19](https://react.dev/) + [@opentui/react](https://github.com/anomalyco/opentui)** — terminal UI renderer
- **[protobufjs](https://github.com/protobufjs/protobuf.js/)** — `tfs` parameter encoding
- **[Cheerio](https://cheerio.js.org/)** — HTML parsing
- **[Bun](https://bun.sh/)** — runtime and test runner

## 🤝 Credits

- Inspired by [fast-flights](https://github.com/AWeirdDev/flights) by @AWeirdDev
- Keymap engine and TUI architecture patterns from [ghui](https://github.com/kitlangton/ghui) by @kitlangton (MIT)

## 📄 License

MIT

## 🐛 Known Limitations

1. **Google's page structure** can change; parsing may need updating when it does
2. **Rate limiting**: Google may throttle excessive requests — production mode's limiter is deliberately conservative
3. **Currency**: prices come back in whatever currency Google serves unless `--currency` is set
4. **Board width**: the TUI's full price column needs a ≥120-column terminal
