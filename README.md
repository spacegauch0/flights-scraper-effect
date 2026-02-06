# ✈️ Google Flights Scraper (Effect + Protocol Buffers)

A high-performance Google Flights scraper built with **TypeScript Effect** and **Protocol Buffers**, inspired by [fast-flights](https://github.com/AWeirdDev/flights).

## 🚀 Features

### Core Capabilities
- ✅ **One-way, Round-trip, Multi-city flights**
- ✅ **All cabin classes** (Economy, Premium Economy, Business, First)
- ✅ **Multiple passengers** (Adults, Children, Infants in seat/on lap)
- ✅ **Advanced filtering** (Price, Duration, Airlines, Stops)
- ✅ **Flexible sorting** (Price, Duration, Airline)
- ✅ **Price indicator** (Low/Typical/High)
- ✅ **Detailed flight info** (Departure, Arrival, Duration, Stops, Delays)

### Production Features 🎯
- ✅ **REST API** with Hono (API key authentication, JSON responses)
- ✅ **Aggressive response caching** (30 min TTL, 500 entry cache, HTTP cache headers)
- ✅ **Rate limiting** (10 req/min, protects against blocking)
- ✅ **Retry logic** with exponential backoff (3 attempts default)
- ✅ **Enhanced error messages** with troubleshooting guides

### Technical Advantages
- ⚡ **5x faster** than Puppeteer (HTTP requests vs browser automation)
- 💰 **4x less memory** usage
- 🌐 **Edge-compatible** (No browser required!)
- 🔒 **Type-safe** with Effect error handling
- 📦 **Lightweight** dependencies
- 🔄 **Production-ready** with built-in reliability features

## 📦 Installation

```bash
bun install
# or
npm install
```

## 🎯 Quick Start

### Using the REST API

Start the REST API server:

```bash
# Create .env file with your API key
echo "API_KEY=your-secret-api-key-here" > .env
echo "PORT=3000" >> .env

# Start the server
bun run api
# or
bun run server
```

Then make requests:

```bash
# Health check
curl http://localhost:3000/health -H "x-api-key: your-secret-api-key-here"

# Search flights
curl "http://localhost:3000/api/flights?from=JFK&to=LHR&departDate=2026-01-19&limit=10" \
  -H "x-api-key: your-secret-api-key-here"
```

See [REST API Documentation](#-rest-api) for full details.

### Using the CLI

The easiest way to get started is using the command-line interface:

```bash
# Launch interactive TUI
bun run start

# Or use CLI directly
bun run cli --from JFK --to LHR --depart-date 2026-01-19
```

### Using as a Library

You can also use the scraper as a library in your own code:

```typescript
import { Effect } from "effect"
import { ScraperService, ScraperProtobufLive } from "./src"

const program = Effect.gen(function* () {
  const scraper = yield* ScraperService
  
  const result = yield* scraper.scrape(
    "JFK",              // From
    "LHR",              // To
    "2026-01-19",       // Depart date
    "one-way",          // Trip type
    undefined,          // Return date (for round-trip)
    "price-asc",        // Sort by price ascending
    { limit: 10 },      // Filters
    "economy",          // Seat class
    { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }, // Passengers
    ""                  // Currency (empty = default)
  )
  
  console.log(`Found ${result.flights.length} flights`)
  console.log(`Price level: ${result.current_price}`)
})

Effect.runPromise(program.pipe(Effect.provide(ScraperProtobufLive)))
```

## 📁 Project Structure

```
flights-scraper-effect/
├── src/
│   ├── api/              # REST API server
│   │   ├── server-hono.ts # Hono-based HTTP server
│   │   ├── index.ts      # API server entry point
│   │   └── README.md     # API documentation
│   ├── cli/              # Command-line interface
│   │   └── index.ts      # CLI implementation with argument parsing
│   ├── tui/              # Terminal User Interface
│   │   └── index.ts      # Interactive TUI implementation
│   ├── domain/           # Types, schemas, and errors
│   │   ├── types.ts      # FlightOption, Result, filters, etc.
│   │   ├── errors.ts     # ScraperError and error helpers
│   │   ├── validation.ts # Validation utilities
│   │   └── index.ts
│   ├── services/         # Service interface and implementations
│   │   ├── scraper.ts    # Service interface definition
│   │   ├── scraper-protobuf.ts    # HTTP-based implementation
│   │   ├── scraper-production.ts  # Production with cache/retry/rate-limit
│   │   └── index.ts
│   ├── utils/            # Utility modules
│   │   ├── cache.ts      # Response caching
│   │   ├── rate-limiter.ts  # Rate limiting
│   │   ├── retry.ts      # Retry with exponential backoff
│   │   ├── protobuf.ts   # Protocol buffer encoding
│   │   └── index.ts
│   ├── cli.ts            # Main entry point (routes to CLI or TUI)
│   └── index.ts          # Library exports
├── docs/                 # Documentation
│   ├── MIGRATION.md      # Puppeteer → Protobuf migration
│   ├── PRODUCTION.md     # Production features guide
│   ├── IMPLEMENTATION_STATUS.md  # Feature comparison
│   ├── EFFECT_BEST_PRACTICES.md  # Effect best practices guide
│   └── SUMMARY.md        # Implementation summary
├── .env.example          # Environment variables template
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Configuration

### Trip Types
- `"one-way"` - One-way flight
- `"round-trip"` - Round-trip flight (requires `returnDate`)
- `"multi-city"` - Multi-city (not fully implemented)

### Seat Classes
- `"economy"` - Economy class
- `"premium-economy"` - Premium Economy
- `"business"` - Business class
- `"first"` - First class

### Passengers
```typescript
{
  adults: number,           // Ages 18+
  children: number,         // Ages 2-11
  infants_in_seat: number,  // Under 2, with seat
  infants_on_lap: number    // Under 2, on lap
}
```

### Filters
```typescript
{
  maxPrice?: number,             // Maximum price
  minPrice?: number,             // Minimum price
  maxDurationMinutes?: number,   // Maximum duration
  airlines?: string[],           // Filter by airlines
  nonstopOnly?: boolean,         // Only nonstop flights
  max_stops?: number,            // Max stops (0, 1, 2)
  limit?: number | "all"         // Result limit
}
```

### Sort Options
- `"price-asc"` - Price: low to high
- `"price-desc"` - Price: high to low
- `"duration-asc"` - Duration: shortest to longest
- `"duration-desc"` - Duration: longest to shortest
- `"airline"` - Airline: alphabetical
- `"none"` - No sorting

## 📊 Output Format

```typescript
{
  current_price?: "low" | "typical" | "high",
  flights: [
    {
      is_best?: boolean,
      name: string,              // Airline name
      departure: string,         // Departure time
      arrival: string,           // Arrival time
      arrival_time_ahead?: string, // "+1 day" if next day
      duration: string,          // "12 hr 30 min"
      stops: number,             // Number of stops
      delay?: string,            // Delay info
      price: string              // "ARS 299,733"
    }
  ]
}
```

## 🌐 REST API

The project includes a REST API server built with [Hono](https://hono.dev/) for Bun. All endpoints require API key authentication via the `x-api-key` header.

### Setup

1. Create a `.env` file:
```bash
API_KEY=your-secret-api-key-here
PORT=3000
```

2. Start the server:
```bash
bun run api
# or
bun run server
```

### Caching

The API uses **aggressive caching** to maximize performance:

- **30-minute TTL** - Responses cached for 30 minutes (longer than default 15 min)
- **500 entry cache** - Large cache size to handle many concurrent searches
- **HTTP cache headers** - Includes `Cache-Control` headers for CDN/proxy caching
- **Cache status indicator** - Responses include `cached: true/false` and `X-Cache: HIT/MISS` headers
- **Stale-while-revalidate** - Serves stale content while refreshing in background

Cache keys include all search parameters (routes, dates, filters, sort, passengers) ensuring accurate cache hits.

### Endpoints

#### GET /health

Health check endpoint.

```bash
curl http://localhost:3000/health -H "x-api-key: your-api-key"
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-06T00:00:00.000Z"
}
```

#### GET /api/flights

Search for flights using query parameters.

**Query Parameters:**
- `from` (required): Origin airport code (3-letter IATA, e.g., `JFK`)
- `to` (required): Destination airport code (3-letter IATA, e.g., `LHR`)
- `departDate` (required): Departure date (`YYYY-MM-DD`)
- `tripType` (optional): `one-way`, `round-trip`, `multi-city` (default: `one-way`)
- `returnDate` (optional): Return date (`YYYY-MM-DD`, required for round-trip)
- `sort` (optional): `price-asc`, `price-desc`, `duration-asc`, `duration-desc`, `airline`, `none` (default: `price-asc`)
- `seat` (optional): `economy`, `premium-economy`, `business`, `first` (default: `economy`)
- `currency` (optional): Currency code (e.g., `USD`, `EUR`)
- `adults` (optional): Number of adults (default: `1`)
- `children` (optional): Number of children (default: `0`)
- `infantsInSeat` (optional): Infants with seat (default: `0`)
- `infantsOnLap` (optional): Infants on lap (default: `0`)
- `maxPrice` (optional): Maximum price filter
- `minPrice` (optional): Minimum price filter
- `maxDurationMinutes` (optional): Maximum duration in minutes
- `airlines` (optional): Comma-separated list of airline names
- `nonstopOnly` (optional): `true`/`false` - only nonstop flights
- `maxStops` (optional): Maximum stops (0, 1, or 2)
- `limit` (optional): Maximum results (default: `10`)

**Example:**
```bash
curl "http://localhost:3000/api/flights?from=JFK&to=LHR&departDate=2026-01-19&sort=price-asc&limit=10" \
  -H "x-api-key: your-api-key"
```

#### POST /api/flights

Search for flights using JSON body.

**Request Body:**
```json
{
  "from": "JFK",
  "to": "LHR",
  "departDate": "2026-01-19",
  "tripType": "one-way",
  "sort": "price-asc",
  "seat": "economy",
  "adults": 1,
  "children": 0,
  "infantsInSeat": 0,
  "infantsOnLap": 0,
  "limit": 10,
  "maxPrice": 1000,
  "maxStops": 1
}
```

**Example:**
```bash
curl -X POST \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"from":"JFK","to":"LHR","departDate":"2026-01-19","limit":10}' \
  http://localhost:3000/api/flights
```

**Response:**
```json
{
  "success": true,
  "cached": false,
  "data": {
    "current_price": "low",
    "flights": [
      {
        "is_best": true,
        "name": "British Airways",
        "departure": "8:00 AM",
        "arrival": "8:00 PM",
        "arrival_time_ahead": "+1 day",
        "duration": "7 hr 0 min",
        "stops": 0,
        "price": "$599"
      }
    ]
  }
}
```

**Cache Headers:**
- `Cache-Control: public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600`
- `X-Cache: HIT` (cached) or `MISS` (fresh)
- Response includes `cached: true/false` in JSON body

### Error Responses

All errors follow this format:

```json
{
  "error": {
    "reason": "Unauthorized|BadRequest|NotFound|InternalError|InvalidInput|RateLimitExceeded|Timeout|ParsingError|NavigationFailed",
    "message": "Error description"
  }
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing or invalid API key)
- `404` - Not Found
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error
- `504` - Gateway Timeout

See [`src/api/README.md`](src/api/README.md) for complete API documentation.

## 🧪 Running

### REST API Server

Start the REST API server:

```bash
bun run api
# or
bun run server
```

The server will start on the port specified in your `.env` file (default: 3000).

### Terminal User Interface (TUI)

Launch the interactive TUI (default when no arguments provided):

```bash
bun run start
# or
bun run tui
# or explicitly
bun run src/cli.ts --tui
```

### Command-Line Interface (CLI)

Use the CLI for programmatic access and automation:

```bash
# Basic CLI usage
bun run cli --from JFK --to LHR --depart-date 2026-01-19

# Production mode (with caching, rate limiting, retry)
bun run production --from LAX --to NRT --depart-date 2026-01-19

# JSON output
bun run cli --from AEP --to SCL --depart-date 2026-01-19 --json

# Full example with filters
bun run cli \
  --from JFK \
  --to LHR \
  --depart-date 2026-01-19 \
  --return-date 2026-01-26 \
  --trip-type round-trip \
  --seat business \
  --adults 2 \
  --max-stops 1 \
  --limit 20 \
  --currency USD
```

### CLI Options

**Required:**
- `--from, -f <code>` - Origin airport code (e.g., JFK)
- `--to, -t <code>` - Destination airport code (e.g., LHR)
- `--depart-date, -d <date>` - Departure date (YYYY-MM-DD)

**Optional:**
- `--return-date, -r <date>` - Return date for round-trip (YYYY-MM-DD)
- `--trip-type <type>` - Trip type: `one-way`, `round-trip`, `multi-city` (default: `one-way`)
- `--sort, -s <option>` - Sort: `price-asc`, `price-desc`, `duration-asc`, `duration-desc`, `airline`, `none` (default: `price-asc`)
- `--seat <class>` - Seat class: `economy`, `premium-economy`, `business`, `first` (default: `economy`)
- `--adults, -a <number>` - Number of adults (default: 1)
- `--children, -c <number>` - Number of children (default: 0)
- `--infants-in-seat <number>` - Infants in seat (default: 0)
- `--infants-on-lap <number>` - Infants on lap (default: 0)
- `--max-price <number>` - Maximum price filter
- `--min-price <number>` - Minimum price filter
- `--max-duration <minutes>` - Maximum duration in minutes
- `--max-stops <0|1|2>` - Maximum number of stops (default: 2)
- `--nonstop-only` - Only show nonstop flights
- `--airlines <list>` - Comma-separated list of airlines
- `--limit, -l <number|all>` - Limit number of results (default: 10)
- `--currency <code>` - Currency code (e.g., USD, EUR)
- `--production, -p` - Use production mode (caching, rate limiting, retry)
- `--json, -j` - Output results as JSON
- `--help, -h` - Show help message

## 🖥️ Terminal User Interface (TUI)

The project includes an interactive terminal UI built with [OpenTUI](https://github.com/sst/opentui):

![TUI Screenshot](docs/tui-preview.png)

**Features:**
- Interactive form with airport inputs
- Trip type selection (One-way / Round-trip)
- Seat class selection (Economy, Premium Economy, Business, First)
- Max stops filter
- Real-time flight search results
- Sortable table view with keyboard navigation
- Color-coded price level indicators
- Mouse support
- Direct links to Google Flights booking pages

**Controls:**
- `Enter` - Search for flights (form mode) / Open selected flight (table mode)
- `Tab` / `Shift+Tab` - Navigate between form fields
- `Ctrl+R` - Focus results table
- `↑/↓` - Navigate table rows (table mode)
- `←/→` - Navigate table columns (table mode)
- `Space` - Sort by selected column (table mode)
- `Esc` - Exit table mode, return to form
- `Ctrl+C` - Exit application

## 📝 Example Configurations

### Business Class Round-trip for Family
```typescript
const result = yield* scraper.scrape(
  "LAX", "NRT", "2026-01-19", "round-trip", "2026-01-26",
  "price-asc",
  { max_stops: 1, limit: 20 },
  "business",
  { adults: 2, children: 1, infants_in_seat: 0, infants_on_lap: 1 },
  "USD"
)
```

### Budget Economy with Filters
```typescript
const result = yield* scraper.scrape(
  "ORD", "CDG", "2026-01-19", "one-way", undefined,
  "price-asc",
  { 
    maxPrice: 500, 
    maxDurationMinutes: 12 * 60,
    airlines: ["United", "American"],
    limit: 15
  },
  "economy",
  { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
  "USD"
)
```

## 📚 Tech Stack

- **[Effect](https://effect.website/)** - Functional programming for TypeScript with type-safe error handling
- **[@effect/platform](https://effect.website/docs/platform)** - Platform abstractions (HTTP client)
- **[@effect/schema](https://effect.website/docs/schema)** - Schema validation and type safety
- **[Hono](https://hono.dev/)** - Fast web framework for Bun
- **[protobufjs](https://github.com/protobufjs/protobuf.js/)** - Protocol Buffer encoding
- **[Cheerio](https://cheerio.js.org/)** - HTML parsing
- **[OpenTUI](https://github.com/sst/opentui)** - Terminal user interfaces
- **[Bun](https://bun.sh/)** - Fast JavaScript runtime

## 🤝 Credits

- Inspired by [fast-flights](https://github.com/AWeirdDev/flights) by @AWeirdDev
- Reverse engineering insights from the Python implementation

## 🚀 Deployment

### Vercel Deployment

The API is ready to deploy to Vercel as a serverless function.

**Quick Deploy:**

```bash
# Install Vercel CLI
npm i -g vercel

# Login and deploy
vercel

# Set environment variable
vercel env add API_KEY

# Deploy to production
vercel --prod
```

**Configuration:**
- Serverless function: `api/index.ts`
- Runtime: Node.js 20.x
- Max duration: 60 seconds
- All routes rewrite to `/api` handler

**Environment Variables:**
- `API_KEY` (required) - Your API key for authentication

**Features:**
- ✅ Serverless function with Hono
- ✅ Aggressive caching (30 min TTL, 500 entries)
- ✅ HTTP cache headers for CDN caching
- ✅ Automatic handler reuse within instances

**Note:** Cache is in-memory and per-instance. For distributed caching across Vercel instances, consider using Vercel KV or Redis.

See [`DEPLOY.md`](DEPLOY.md) for detailed deployment instructions.

## 📄 License

MIT

## 🐛 Known Limitations

1. **JavaScript Data Extraction**: Some flight details may be incomplete depending on Google's response format
2. **Rate Limiting**: Google may rate-limit excessive requests
3. **Price Currency**: Prices are returned in the currency Google serves (may vary by region)
4. **Multi-city**: Not fully tested yet
5. **Vercel Cache**: In-memory cache is per-instance. For distributed caching, use external cache (Redis/Vercel KV)
