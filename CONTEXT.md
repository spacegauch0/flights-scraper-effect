# Google Flights Scraper

A browserless Google Flights scraper: searches are encoded straight into
Google's wire formats, results are parsed from the pages and private RPC
responses the real web app uses, and a terminal UI drives the whole thing.

## Language

### Searching

**Search**:
One validated request for flights - route, dates, trip type, cabin, travelers, filters (`ScrapeRequest`).
_Avoid_: Query, params

**Scraper**:
The module that turns a Search into a Result; the `ScraperService` seam with three adapters (protobuf, mock, and the production middleware).
_Avoid_: Client, fetcher

**Production middleware**:
The Scraper adapter that wraps any inner Scraper with response caching and rate limiting; it owns when *not* to fetch.
_Avoid_: Production scraper (it isn't a scraper - it decorates one)

**Search page**:
The Google Flights HTML page for a Search; the source of both flight cards and the RPC session.

**Result**:
What a Search returns: the price indicator plus a list of flights.

### Google's wire formats

**tfs**:
The base64 protobuf URL parameter that encodes a Search; produced by the encoder in `utils/protobuf.ts`.

**Flights RPC**:
Google's private FlightsFrontendService endpoints (GetShoppingResults, GetBookingResults); the transport in `services/google-rpc.ts` owns its session, request envelope, and response envelope.
_Avoid_: API (it is undocumented and versionless)

**RPC session**:
The `bl`/`fSid` values scraped from a Search page that every Flights RPC call must carry.
_Avoid_: Token (see Booking token)

**Booking token**:
A per-flight protobuf blob in the Search page; field 2 is the flight's Designator, and any one of them doubles as the session ticket for booking lookups.

**Designator**:
A marketing-carrier flight designator ("BA178"): two-character carrier code + number (`FlightDesignator`). The cross-module currency for selecting a specific flight.
_Avoid_: Flight number (ambiguous - it's only the numeric part)

### Multi-city

**Picker**:
The step-based interface over Google's multi-city wizard: `startMultiCityPicker` yields a step; choosing an option yields the next.
_Avoid_: Session, wizard (implementation words)

**Step**:
Where the Picker stands: `PickLeg` (choose from this leg's options) or `Complete` (the finished Itinerary).

**Leg option**:
One bookable flight for the leg being picked, with the token and Designator needed to select it.

**Itinerary**:
The finished multi-city outcome: each leg paired with its chosen flight (`ItineraryLeg[]`).

### Booking

**Booking option**:
One "Book with X" provider offer (provider, price, redirect URL) for a specific flight, fetched via the Flights RPC.

### Terminal UI

**Shell**:
The one hook (`useAppShell`) owning all TUI state, actions, and keymap wiring; components render its bundle.

**Board**:
The results table styled as a departure board, with its title bar (count or Picker step + price verdict).

**Keymap**:
The bindings-as-data engine: per-mode keymaps composed into one, dispatched purely.

**Palette**:
The ctrl+p command palette; its entries are the Keymap's bindings for the mode it opened from.

**Hints**:
The footer legend of currently-possible actions, derived from the same state that gates the Keymap.

## Relationships

- A **Search** goes through the **Scraper** seam and returns a **Result**
- The **Production middleware** decorates any **Scraper** adapter
- A **Search page** yields flight cards, **Booking tokens**, and the **RPC session**
- The **Picker** advances one **Step** per chosen **Leg option** until it yields an **Itinerary**
- A **Designator** selects the flight in both **Booking option** lookups and **Picker** choices
- The **Shell** consumes the **Scraper**, **Picker**, and **Booking option** modules; the **Board**, **Palette**, and **Hints** render its state

## Example dialogue

> **Dev:** "When the user hits enter on a **Board** row during multi-city, do we call the **Scraper**?"
> **Domain expert:** "No - the **Shell** passes that **Leg option** to the **Picker**, which returns the next **Step**. The **Scraper** only handles whole **Searches**; the greedy CLI path walks the same **Picker** internally."

> **Dev:** "Where do I get the flight's number for a **Booking option** lookup?"
> **Domain expert:** "It's not a number, it's a **Designator** - decoded from the flight's **Booking token** when the **Search page** was parsed."

## Flagged ambiguities

- "flight_number" (the `FlightOption` field) actually carries a full **Designator** ("BA178"), not just a number - the field name is kept for output compatibility.
- "session" used to mean both the multi-city wizard state and the RPC values; resolved: **RPC session** is the transport's concern, and the wizard state is internal to the **Picker**.
