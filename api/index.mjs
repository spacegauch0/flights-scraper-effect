// src/api/server-hono.ts
import { Hono } from "hono";
import { Effect as Effect9, Layer as Layer5 } from "effect";
import { FetchHttpClient } from "@effect/platform";

// src/services/scraper.ts
import { Context } from "effect";
var ScraperService = Context.GenericTag("ScraperService");

// src/services/scraper-protobuf.ts
import { Effect as Effect4, Layer, Console } from "effect";
import { HttpClient } from "@effect/platform";

// src/domain/types.ts
import { Schema } from "@effect/schema";
var TripTypeSchema = Schema.Literal("one-way", "round-trip", "multi-city");
var SeatClassSchema = Schema.Literal("economy", "premium-economy", "business", "first");
var PassengersSchema = Schema.Struct({
  adults: Schema.Number.pipe(Schema.int(), Schema.positive()),
  children: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  infants_in_seat: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  infants_on_lap: Schema.Number.pipe(Schema.int(), Schema.nonNegative())
});
var AirportCodeSchema = Schema.String.pipe(
  Schema.length(3),
  Schema.pattern(/^[A-Z]{3}$/),
  Schema.brand("AirportCode")
);
var DateStringSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.brand("DateString")
);
var SortOptionSchema = Schema.Literal(
  "price-asc",
  // Price: low to high
  "price-desc",
  // Price: high to low
  "duration-asc",
  // Duration: shortest to longest
  "duration-desc",
  // Duration: longest to shortest
  "airline",
  // Airline: alphabetical
  "none"
  // No sorting (default order)
);
var FlightOption = class extends Schema.Class("FlightOption")({
  is_best: Schema.optional(Schema.Boolean),
  name: Schema.String,
  // Airline name(s)
  departure: Schema.String,
  // Departure time
  arrival: Schema.String,
  // Arrival time
  arrival_time_ahead: Schema.optional(Schema.String),
  // "+1 day" if arrives next day
  duration: Schema.String,
  // Flight duration
  stops: Schema.Number,
  // Number of stops
  delay: Schema.optional(Schema.String),
  // Delay information if any
  price: Schema.String,
  // Price as formatted string
  deep_link: Schema.optional(Schema.String)
  // Direct booking/details link
}) {
};
var Result = class extends Schema.Class("Result")({
  current_price: Schema.optional(Schema.Literal("low", "typical", "high")),
  flights: Schema.Array(FlightOption)
}) {
};
var FlightFiltersSchema = Schema.Struct({
  /** Maximum price (inclusive). Flights above this price will be excluded. */
  maxPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  /** Minimum price (inclusive). Flights below this price will be excluded. */
  minPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  /** Maximum duration in minutes. Flights longer than this will be excluded. */
  maxDurationMinutes: Schema.optional(Schema.Number.pipe(Schema.positive())),
  /** Filter by specific airlines. Only flights from these airlines will be included. */
  airlines: Schema.optional(Schema.Array(Schema.String).pipe(Schema.mutable)),
  /** Filter by number of stops. If true, only nonstop flights are included. */
  nonstopOnly: Schema.optional(Schema.Boolean),
  /** Maximum number of stops (0 = nonstop, 1 = up to 1 stop, 2 = up to 2 stops) */
  max_stops: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 2))),
  /** 
   * Maximum number of results to return. Applied after filtering and sorting.
   * Use "all" to automatically load all results by clicking "View more flights".
   */
  limit: Schema.optional(Schema.Union(Schema.Number.pipe(Schema.int(), Schema.positive()), Schema.Literal("all")))
});

// src/domain/errors.ts
import { Schema as Schema2 } from "@effect/schema";
var ScraperError = class extends Schema2.TaggedError()("ScraperError", {
  reason: Schema2.Literal("NavigationFailed", "Timeout", "ParsingError", "Unknown", "InvalidInput", "RateLimitExceeded"),
  message: Schema2.String
}) {
};
var ScraperErrors = {
  navigationFailed: (url, details) => new ScraperError({
    reason: "NavigationFailed",
    message: `Failed to fetch flight data from Google Flights.
URL: ${url}
Details: ${details}

Possible solutions:
- Check your internet connection
- Try again in a few moments
- Verify the airport codes are correct`
  }),
  timeout: (operation) => new ScraperError({
    reason: "Timeout",
    message: `Operation timed out: ${operation}

Possible solutions:
- The request is taking too long, please try again
- Check your network connection
- Google Flights may be experiencing issues`
  }),
  parsingError: (details) => new ScraperError({
    reason: "ParsingError",
    message: `Failed to parse flight data from the response.
Details: ${details}

Possible solutions:
- Google Flights may have changed their page structure
- Try using different airports or dates
- Report this issue if it persists`
  }),
  invalidInput: (field, reason) => new ScraperError({
    reason: "InvalidInput",
    message: `Invalid input for ${field}: ${reason}

Please check:
- Airport codes are valid (e.g., JFK, LHR)
- Dates are in YYYY-MM-DD format
- Return date is provided for round-trip flights
- Passenger counts are positive numbers`
  }),
  rateLimitExceeded: (waitTimeSeconds) => new ScraperError({
    reason: "RateLimitExceeded",
    message: `Rate limit exceeded. Too many requests in a short time.
Please wait ${waitTimeSeconds} seconds before trying again.

Note: Google Flights limits the number of requests to prevent abuse.`
  }),
  unknown: (error) => new ScraperError({
    reason: "Unknown",
    message: `An unexpected error occurred: ${String(error)}

Please try again or report this issue if it persists.`
  })
};

// src/domain/validation.ts
import { Effect as Effect2 } from "effect";

// src/utils/protobuf.ts
import protobuf from "protobufjs";
import { Effect as Effect3 } from "effect";
var encodeFlightSearch = (flightData, tripType, seat, passengers) => Effect3.try({
  try: () => {
    const root = protobuf.Root.fromJSON({
      nested: {
        Info: {
          fields: {
            data: { rule: "repeated", type: "FlightData", id: 3 },
            seat: { type: "Seat", id: 9 },
            passengers: { rule: "repeated", type: "Passenger", id: 8 },
            trip: { type: "Trip", id: 19 }
          }
        },
        FlightData: {
          fields: {
            date: { type: "string", id: 2 },
            from_flight: { type: "Airport", id: 13 },
            to_flight: { type: "Airport", id: 14 },
            max_stops: { type: "int32", id: 5 },
            airlines: { rule: "repeated", type: "string", id: 6 }
          }
        },
        Airport: {
          fields: {
            airport: { type: "string", id: 2 }
          }
        },
        Seat: {
          values: {
            UNKNOWN_SEAT: 0,
            ECONOMY: 1,
            PREMIUM_ECONOMY: 2,
            BUSINESS: 3,
            FIRST: 4
          }
        },
        Trip: {
          values: {
            UNKNOWN_TRIP: 0,
            ROUND_TRIP: 1,
            ONE_WAY: 2,
            MULTI_CITY: 3
          }
        },
        Passenger: {
          values: {
            UNKNOWN_PASSENGER: 0,
            ADULT: 1,
            CHILD: 2,
            INFANT_IN_SEAT: 3,
            INFANT_ON_LAP: 4
          }
        }
      }
    });
    const Info = root.lookupType("Info");
    const seatMap = {
      "economy": 1,
      "premium-economy": 2,
      "business": 3,
      "first": 4
    };
    const tripMap = {
      "round-trip": 1,
      "one-way": 2,
      "multi-city": 3
    };
    const passengerArray = [];
    for (let i = 0; i < passengers.adults; i++) passengerArray.push(1);
    for (let i = 0; i < passengers.children; i++) passengerArray.push(2);
    for (let i = 0; i < passengers.infants_in_seat; i++) passengerArray.push(3);
    for (let i = 0; i < passengers.infants_on_lap; i++) passengerArray.push(4);
    const data = flightData.map((fd) => ({
      date: fd.date,
      // Keep as YYYY-MM-DD format (e.g., "2026-01-25")
      from_flight: { airport: fd.from_airport },
      to_flight: { airport: fd.to_airport },
      max_stops: fd.max_stops,
      airlines: fd.airlines || []
    }));
    const message = Info.create({
      data,
      seat: seatMap[seat],
      passengers: passengerArray,
      trip: tripMap[tripType]
    });
    const buffer = Info.encode(message).finish();
    const base64 = Buffer.from(buffer).toString("base64");
    const urlSafe = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    return urlSafe;
  },
  catch: (error) => new ScraperError({
    reason: "ParsingError",
    message: `Failed to encode flight search: ${error}`
  })
});

// src/services/scraper-protobuf.ts
import * as cheerio from "cheerio";
var fetchFlightsHtml = (url) => Effect4.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Cache-Control": "max-age=0"
    }
  }).pipe(
    Effect4.mapError(
      (error) => new ScraperError({
        reason: "NavigationFailed",
        message: `Failed to fetch ${url}: ${String(error)}`
      })
    )
  );
  const body = yield* response.text.pipe(
    Effect4.mapError(
      (error) => new ScraperError({
        reason: "NavigationFailed",
        message: `Failed to read response body: ${String(error)}`
      })
    )
  );
  return body;
});
var extractJavaScriptData = (html) => Effect4.try({
  try: () => parseHtmlFallback(html),
  catch: (e) => new ScraperError({ reason: "ParsingError", message: `Failed to parse HTML: ${String(e)}` })
});
var parseHtmlFallback = (html) => {
  const $ = cheerio.load(html);
  const flights = [];
  const flightContainers = $('div[jsname="IWWDBc"], div[jsname="YdtKid"]');
  flightContainers.each((containerIndex, container) => {
    const isBestSection = containerIndex === 0;
    $(container).find("ul.Rk10dc li").each((itemIndex, item) => {
      const $item = $(item);
      const name = $item.find("div.sSHqwe.tPgKwe.ogfYpf span").first().text().trim() || "Unknown";
      const timeNodes = $item.find("span.mv1WYe div");
      const departure = timeNodes.length > 0 ? $(timeNodes[0]).text().trim().replace(/\s+/g, " ") : "";
      const arrival = timeNodes.length > 1 ? $(timeNodes[1]).text().trim().replace(/\s+/g, " ") : "";
      const arrivalTimeAhead = $item.find("span.bOzv6").first().text().trim() || void 0;
      const durationEl = $item.find("div.gvkrdb, li div.Ak5kof div").first();
      const duration = durationEl.text().trim() || "N/A";
      const stopsEl = $item.find(".BbR8Ec .ogfYpf").first();
      const stopsText = stopsEl.text().trim();
      let stops = 0;
      if (stopsText && stopsText !== "Nonstop") {
        const match = stopsText.match(/^(\d+)/);
        if (match) stops = parseInt(match[1]);
      }
      const delay = $item.find(".GsCCve").first().text().trim() || void 0;
      const priceEl = $item.find(".YMlIz.FpEdX span").first();
      const priceText = priceEl.length ? priceEl.text().trim() : $item.find(".YMlIz.FpEdX").first().text().trim();
      const priceMatch = priceText.match(/\$?\s*([\d,]+)/);
      const numeric = priceMatch ? priceMatch[1].replace(/,/g, "") : void 0;
      const price = numeric ? `$${numeric}` : "N/A";
      let deep_link = void 0;
      const bookingLink = $item.find('a[href*="/travel/flights/booking"], a[href*="tfs="]').first();
      if (bookingLink.length) {
        const href = bookingLink.attr("href");
        if (href) {
          deep_link = href.startsWith("http") ? href : `https://www.google.com${href}`;
        }
      }
      if (!deep_link) {
        const linkEl = $item.find('a[data-tfs], a[data-url*="booking"]').first();
        if (linkEl.length) {
          const dataTfs = linkEl.attr("data-tfs");
          if (dataTfs) {
            deep_link = `https://www.google.com/travel/flights/booking?tfs=${encodeURIComponent(dataTfs)}&curr=USD`;
          } else {
            const dataUrl = linkEl.attr("data-url");
            if (dataUrl) {
              deep_link = dataUrl.startsWith("http") ? dataUrl : `https://www.google.com${dataUrl}`;
            }
          }
        }
      }
      if (!deep_link) {
        const jsDataEl = $item.find('[jsdata*="tfs"], [data-flt-ve]').first();
        if (jsDataEl.length) {
          const jsdata = jsDataEl.attr("jsdata") || "";
          const tfsMatch = jsdata.match(/tfs=([^&\s;]+)/);
          if (tfsMatch) {
            deep_link = `https://www.google.com/travel/flights/booking?tfs=${tfsMatch[1]}&curr=USD`;
          }
        }
      }
      if (!deep_link) {
        const clickableEl = $item.find('[onclick*="booking"], [jsaction*="select"]').first();
        const onclick = clickableEl.attr("onclick") || clickableEl.attr("jsaction") || "";
        const urlMatch = onclick.match(/\/travel\/flights\/booking\?[^'"]+/);
        if (urlMatch) {
          deep_link = `https://www.google.com${urlMatch[0]}`;
        }
      }
      if (name !== "Unknown") {
        flights.push(new FlightOption({
          is_best: isBestSection && itemIndex === 0,
          name,
          departure,
          arrival,
          arrival_time_ahead: arrivalTimeAhead,
          duration,
          stops,
          delay,
          price,
          deep_link
        }));
      }
    });
  });
  const priceIndicatorText = $("span.gOatQ").text().trim().toLowerCase();
  let current_price = void 0;
  if (priceIndicatorText.includes("low")) current_price = "low";
  else if (priceIndicatorText.includes("typical")) current_price = "typical";
  else if (priceIndicatorText.includes("high")) current_price = "high";
  return new Result({
    current_price,
    flights
  });
};
var sortFlights = (flights, sortOption) => {
  if (sortOption === "none") return [...flights];
  return [...flights].sort((a, b) => {
    switch (sortOption) {
      case "price-asc": {
        const priceA = parseFloat(a.price.replace(/[^0-9.-]/g, "")) || 0;
        const priceB = parseFloat(b.price.replace(/[^0-9.-]/g, "")) || 0;
        return priceA - priceB;
      }
      case "price-desc": {
        const priceA = parseFloat(a.price.replace(/[^0-9.-]/g, "")) || 0;
        const priceB = parseFloat(b.price.replace(/[^0-9.-]/g, "")) || 0;
        return priceB - priceA;
      }
      case "duration-asc": {
        return parseDurationToMinutes(a.duration) - parseDurationToMinutes(b.duration);
      }
      case "duration-desc": {
        return parseDurationToMinutes(b.duration) - parseDurationToMinutes(a.duration);
      }
      case "airline": {
        return a.name.localeCompare(b.name);
      }
      default:
        return 0;
    }
  });
};
var parseDurationToMinutes = (duration) => {
  const hourMatch = duration.match(/(\d+)\s*hr/);
  const minMatch = duration.match(/(\d+)\s*min/);
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
  const minutes = minMatch ? parseInt(minMatch[1]) : 0;
  return hours * 60 + minutes;
};
var filterFlights = (flights, filters) => {
  return flights.filter((flight) => {
    const price = parseFloat(flight.price.replace(/[^0-9.-]/g, "")) || 0;
    const durationMinutes = parseDurationToMinutes(flight.duration);
    if (filters.maxPrice !== void 0 && price > filters.maxPrice) return false;
    if (filters.minPrice !== void 0 && price < filters.minPrice) return false;
    if (filters.maxDurationMinutes !== void 0 && durationMinutes > filters.maxDurationMinutes) return false;
    if (filters.airlines && filters.airlines.length > 0) {
      const matchesAirline = filters.airlines.some(
        (airline) => flight.name.toLowerCase().includes(airline.toLowerCase())
      );
      if (!matchesAirline) return false;
    }
    if (filters.nonstopOnly && flight.stops !== 0) return false;
    if (filters.max_stops !== void 0 && flight.stops > filters.max_stops) return false;
    return true;
  });
};
var ScraperProtobufLive = Layer.effect(
  ScraperService,
  Effect4.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    return ScraperService.of({
      scrape: (from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency) => Effect4.gen(function* () {
        if (tripType === "round-trip" && !returnDate) {
          return yield* Effect4.fail(new ScraperError({ reason: "InvalidInput", message: "Return date is required for round-trip flights." }));
        }
        const seatClass = seat || "economy";
        const passengerCounts = passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 };
        const curr = currency || "";
        const flightData = [
          {
            date: departDate,
            from_airport: from,
            to_airport: to,
            max_stops: filters.max_stops,
            airlines: filters.airlines
          }
        ];
        if (tripType === "round-trip" && returnDate) {
          flightData.push({
            date: returnDate,
            from_airport: to,
            to_airport: from,
            max_stops: filters.max_stops,
            airlines: filters.airlines
          });
        }
        const tfs = yield* encodeFlightSearch(flightData, tripType, seatClass, passengerCounts);
        const params = new URLSearchParams({ tfs, hl: "en", tfu: "EgQIABABIgA" });
        if (curr) params.set("curr", curr);
        const url = `https://www.google.com/travel/flights?${params.toString()}`;
        yield* Console.log(`\u{1F680} Fetching flights via HTTP: ${url.substring(0, 100)}...`);
        const html = yield* fetchFlightsHtml(url).pipe(
          Effect4.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
        );
        yield* Console.log(`\u{1F4C4} Received ${html.length} bytes of HTML`);
        const result = yield* extractJavaScriptData(html);
        yield* Console.log(`\u2708\uFE0F  Extracted ${result.flights.length} raw flight entries`);
        if (result.current_price) {
          yield* Console.log(`\u{1F4B0} Price indicator: ${result.current_price}`);
        }
        const filteredFlights = filterFlights(result.flights, filters);
        const sortedFlights = sortFlights(filteredFlights, sortOption);
        if (typeof filters.limit === "number") {
          return new Result({ current_price: result.current_price, flights: sortedFlights.slice(0, filters.limit) });
        }
        return new Result({ current_price: result.current_price, flights: sortedFlights });
      })
    });
  })
);

// src/services/scraper-production.ts
import { Effect as Effect8, Layer as Layer4, Console as Console3 } from "effect";
import { HttpClient as HttpClient2 } from "@effect/platform";

// src/utils/cache.ts
import { Effect as Effect5, Layer as Layer2, Context as Context3, Ref } from "effect";
var defaultCacheConfig = {
  ttl: 15 * 60 * 1e3,
  // 15 minutes
  maxSize: 100
};
var CacheService = Context3.GenericTag("CacheService");
var createCacheKey = (from, to, departDate, tripType, returnDate, seat, adults, children, infants_in_seat, infants_on_lap) => {
  const params = [
    from,
    to,
    departDate,
    tripType,
    returnDate || "none",
    seat,
    adults,
    children,
    infants_in_seat,
    infants_on_lap
  ];
  return params.join("|");
};
var CacheLive = (config = defaultCacheConfig) => Layer2.effect(
  CacheService,
  Effect5.gen(function* () {
    const { ttl = 15 * 60 * 1e3, maxSize = 100 } = config;
    const cacheRef = yield* Ref.make(/* @__PURE__ */ new Map());
    return CacheService.of({
      get: (key) => Effect5.gen(function* () {
        const cache = yield* Ref.get(cacheRef);
        const entry = cache.get(key);
        if (!entry) {
          return null;
        }
        const now = Date.now();
        if (now - entry.timestamp > ttl) {
          yield* Ref.update(cacheRef, (cache2) => {
            cache2.delete(key);
            return cache2;
          });
          return null;
        }
        return entry.data;
      }),
      set: (key, value) => Effect5.gen(function* () {
        const now = Date.now();
        yield* Ref.update(cacheRef, (cache) => {
          if (cache.size >= maxSize) {
            let oldestKey = null;
            let oldestTime = Infinity;
            for (const [k, v] of cache.entries()) {
              if (v.timestamp < oldestTime) {
                oldestTime = v.timestamp;
                oldestKey = k;
              }
            }
            if (oldestKey) {
              cache.delete(oldestKey);
            }
          }
          cache.set(key, { data: value, timestamp: now });
          return cache;
        });
      }),
      clear: () => Effect5.gen(function* () {
        yield* Ref.set(cacheRef, /* @__PURE__ */ new Map());
      }),
      size: () => Effect5.gen(function* () {
        const cache = yield* Ref.get(cacheRef);
        return cache.size;
      })
    });
  })
);
var CacheDisabled = Layer2.succeed(
  CacheService,
  CacheService.of({
    get: () => Effect5.succeed(null),
    set: () => Effect5.void,
    clear: () => Effect5.void,
    size: () => Effect5.succeed(0)
  })
);

// src/utils/rate-limiter.ts
import { Effect as Effect6, Layer as Layer3, Context as Context4, Ref as Ref2, Duration } from "effect";
var defaultRateLimiterConfig = {
  maxRequests: 10,
  // 10 requests
  windowMs: 60 * 1e3,
  // per minute
  minDelay: 2e3
  // 2 seconds between requests
};
var RateLimiterService = Context4.GenericTag("RateLimiterService");
var RateLimiterLive = (config = defaultRateLimiterConfig) => Layer3.effect(
  RateLimiterService,
  Effect6.gen(function* () {
    const { maxRequests = 10, windowMs = 6e4, minDelay = 2e3 } = config;
    const requestsRef = yield* Ref2.make([]);
    const lastRequestRef = yield* Ref2.make(0);
    return RateLimiterService.of({
      acquire: () => Effect6.gen(function* () {
        const now = Date.now();
        const requests = yield* Ref2.get(requestsRef);
        const windowStart = now - windowMs;
        const recentRequests = requests.filter((r) => r.timestamp > windowStart);
        if (recentRequests.length >= maxRequests) {
          const oldestRequest = recentRequests[0];
          const waitTime = oldestRequest.timestamp + windowMs - now;
          return yield* Effect6.fail(new ScraperError({
            reason: "RateLimitExceeded",
            message: `Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1e3)} seconds before trying again.`
          }));
        }
        const lastRequest = yield* Ref2.get(lastRequestRef);
        const timeSinceLastRequest = now - lastRequest;
        if (timeSinceLastRequest < minDelay && lastRequest > 0) {
          const waitTime = minDelay - timeSinceLastRequest;
          yield* Effect6.sleep(Duration.millis(waitTime));
        }
        yield* Ref2.update(requestsRef, () => [
          ...recentRequests,
          { timestamp: Date.now() }
        ]);
        yield* Ref2.set(lastRequestRef, Date.now());
      }),
      reset: () => Effect6.gen(function* () {
        yield* Ref2.set(requestsRef, []);
        yield* Ref2.set(lastRequestRef, 0);
      }),
      getStats: () => Effect6.gen(function* () {
        const requests = yield* Ref2.get(requestsRef);
        const now = Date.now();
        const windowStart = now - windowMs;
        const recentRequests = requests.filter((r) => r.timestamp > windowStart);
        return {
          requests: recentRequests.length,
          windowMs
        };
      })
    });
  })
);
var RateLimiterDisabled = Layer3.succeed(
  RateLimiterService,
  RateLimiterService.of({
    acquire: () => Effect6.void,
    reset: () => Effect6.void,
    getStats: () => Effect6.succeed({ requests: 0, windowMs: 0 })
  })
);

// src/utils/retry.ts
import { Effect as Effect7, Schedule, Duration as Duration2 } from "effect";
var defaultRetryConfig = {
  maxAttempts: 3,
  initialDelay: 1e3,
  // 1 second
  maxDelay: 3e4,
  // 30 seconds
  backoffFactor: 2
};
var createRetrySchedule = (config = defaultRetryConfig) => {
  const {
    maxAttempts = 3,
    initialDelay = 1e3,
    maxDelay = 3e4,
    backoffFactor = 2
  } = config;
  return Schedule.exponential(Duration2.millis(initialDelay), backoffFactor).pipe(
    Schedule.either(Schedule.spaced(Duration2.millis(maxDelay))),
    Schedule.compose(Schedule.elapsed),
    Schedule.whileOutput(Duration2.lessThanOrEqualTo(Duration2.millis(maxDelay))),
    Schedule.intersect(Schedule.recurs(maxAttempts - 1))
  );
};
var isRetryableError = (error) => {
  return error.reason === "NavigationFailed" || error.reason === "Timeout";
};
var withRetryAndLog = (effect, operationName, config = defaultRetryConfig) => {
  const policy = createRetrySchedule(config);
  return effect.pipe(
    Effect7.tapError(
      (error) => Effect7.log(`\u26A0\uFE0F  ${operationName} failed: ${error.message}. Retrying...`)
    ),
    Effect7.retry({
      schedule: policy,
      while: (error) => {
        return error instanceof ScraperError && isRetryableError(error);
      }
    }),
    Effect7.tapError(
      (error) => Effect7.log(`\u274C ${operationName} failed after all retries: ${error.message}`)
    )
  );
};

// src/services/scraper-production.ts
import * as cheerio2 from "cheerio";
var fetchFlightsHtml2 = (url) => Effect8.gen(function* () {
  const rateLimiter = yield* RateLimiterService;
  yield* rateLimiter.acquire();
  return yield* withRetryAndLog(
    Effect8.gen(function* () {
      const client = yield* HttpClient2.HttpClient;
      const response = yield* client.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Cache-Control": "max-age=0"
        }
      }).pipe(
        Effect8.mapError((error) => ScraperErrors.navigationFailed(url, String(error)))
      );
      const body = yield* response.text.pipe(
        Effect8.mapError((error) => ScraperErrors.navigationFailed(url, `Failed to read response: ${String(error)}`))
      );
      return body;
    }),
    "Fetch Google Flights HTML"
  );
});
var extractJavaScriptData2 = (html) => Effect8.try({
  try: () => parseHtmlFallback2(html),
  catch: (e) => ScraperErrors.parsingError(String(e))
});
var parseHtmlFallback2 = (html) => {
  const $ = cheerio2.load(html);
  const flights = [];
  const cards = $("li.pIav2d");
  cards.each((index, element) => {
    const card = $(element);
    const text = card.text();
    const priceMatch = text.match(/(?:ARS|USD|EUR|GBP|\$)\s*[\u00A0\s]*(\d{1,3}(?:[,\s]\d{3})*|\d+)/);
    const price = priceMatch ? priceMatch[0] : "N/A";
    let airline = "Unknown";
    const airlineElements = card.find(".sSHqwe");
    for (let i = 0; i < airlineElements.length; i++) {
      const currentAirlineText = $(airlineElements[i]).text().trim();
      if (currentAirlineText && !currentAirlineText.includes("kg CO2") && !currentAirlineText.includes("Aged")) {
        airline = currentAirlineText;
        break;
      }
    }
    const duration = card.find(".gvkrdb").text().trim() || "N/A";
    const nonstop = text.includes("Nonstop");
    const stops = nonstop ? 0 : 1;
    let deep_link = void 0;
    const bookingLink = card.find('a[href*="/travel/flights/booking"], a[href*="tfs="]').first();
    if (bookingLink.length) {
      const href = bookingLink.attr("href");
      if (href) {
        deep_link = href.startsWith("http") ? href : `https://www.google.com${href}`;
      }
    }
    if (!deep_link) {
      const linkEl = card.find('a[data-tfs], a[data-url*="booking"]').first();
      if (linkEl.length) {
        const dataTfs = linkEl.attr("data-tfs");
        if (dataTfs) {
          deep_link = `https://www.google.com/travel/flights/booking?tfs=${encodeURIComponent(dataTfs)}&curr=USD`;
        }
      }
    }
    if (!deep_link) {
      const jsDataEl = card.find('[jsdata*="tfs"]').first();
      if (jsDataEl.length) {
        const jsdata = jsDataEl.attr("jsdata") || "";
        const tfsMatch = jsdata.match(/tfs=([^&\s;]+)/);
        if (tfsMatch) {
          deep_link = `https://www.google.com/travel/flights/booking?tfs=${tfsMatch[1]}&curr=USD`;
        }
      }
    }
    if (airline !== "Unknown") {
      flights.push(new FlightOption({
        is_best: index === 0,
        name: airline,
        departure: "",
        arrival: "",
        arrival_time_ahead: void 0,
        duration,
        stops,
        delay: void 0,
        price,
        deep_link
      }));
    }
  });
  const priceIndicatorText = $("span.gOatQ").text().trim().toLowerCase();
  let current_price = void 0;
  if (priceIndicatorText.includes("low")) current_price = "low";
  else if (priceIndicatorText.includes("typical")) current_price = "typical";
  else if (priceIndicatorText.includes("high")) current_price = "high";
  return new Result({
    current_price,
    flights
  });
};
var parseDurationToMinutes2 = (duration) => {
  const hourMatch = duration.match(/(\d+)\s*hr/);
  const minMatch = duration.match(/(\d+)\s*min/);
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
  const minutes = minMatch ? parseInt(minMatch[1]) : 0;
  return hours * 60 + minutes;
};
var sortFlights2 = (flights, sortOption) => {
  if (sortOption === "none") return [...flights];
  return [...flights].sort((a, b) => {
    switch (sortOption) {
      case "price-asc": {
        const priceA = parseFloat(a.price.replace(/[^0-9.-]/g, "")) || 0;
        const priceB = parseFloat(b.price.replace(/[^0-9.-]/g, "")) || 0;
        return priceA - priceB;
      }
      case "price-desc": {
        const priceA = parseFloat(a.price.replace(/[^0-9.-]/g, "")) || 0;
        const priceB = parseFloat(b.price.replace(/[^0-9.-]/g, "")) || 0;
        return priceB - priceA;
      }
      case "duration-asc":
        return parseDurationToMinutes2(a.duration) - parseDurationToMinutes2(b.duration);
      case "duration-desc":
        return parseDurationToMinutes2(b.duration) - parseDurationToMinutes2(a.duration);
      case "airline":
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });
};
var filterFlights2 = (flights, filters) => {
  return flights.filter((flight) => {
    const price = parseFloat(flight.price.replace(/[^0-9.-]/g, "")) || 0;
    const durationMinutes = parseDurationToMinutes2(flight.duration);
    if (filters.maxPrice !== void 0 && price > filters.maxPrice) return false;
    if (filters.minPrice !== void 0 && price < filters.minPrice) return false;
    if (filters.maxDurationMinutes !== void 0 && durationMinutes > filters.maxDurationMinutes) return false;
    if (filters.airlines && filters.airlines.length > 0) {
      const matchesAirline = filters.airlines.some(
        (airline) => flight.name.toLowerCase().includes(airline.toLowerCase())
      );
      if (!matchesAirline) return false;
    }
    if (filters.nonstopOnly && flight.stops !== 0) return false;
    if (filters.max_stops !== void 0 && flight.stops > filters.max_stops) return false;
    return true;
  });
};
var ScraperProductionLive = Layer4.effect(
  ScraperService,
  Effect8.gen(function* () {
    const cache = yield* CacheService;
    const rateLimiter = yield* RateLimiterService;
    const httpClient = yield* HttpClient2.HttpClient;
    return ScraperService.of({
      scrape: (from, to, departDate, tripType, returnDate, sortOption, filters, seat, passengers, currency) => Effect8.gen(function* () {
        if (tripType === "round-trip" && !returnDate) {
          return yield* Effect8.fail(ScraperErrors.invalidInput("returnDate", "Return date is required for round-trip flights"));
        }
        const seatClass = seat || "economy";
        const passengerCounts = passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 };
        const curr = currency || "";
        const cacheKey = createCacheKey(
          from,
          to,
          departDate,
          tripType,
          returnDate,
          seatClass,
          passengerCounts.adults,
          passengerCounts.children,
          passengerCounts.infants_in_seat,
          passengerCounts.infants_on_lap
        );
        const cached = yield* cache.get(cacheKey);
        if (cached) {
          yield* Console3.log("\u{1F4E6} Cache hit! Using cached results");
          const filteredFlights2 = filterFlights2(cached.flights, filters);
          const sortedFlights2 = sortFlights2(filteredFlights2, sortOption);
          const limitedFlights2 = typeof filters.limit === "number" ? sortedFlights2.slice(0, filters.limit) : sortedFlights2;
          return new Result({ current_price: cached.current_price, flights: limitedFlights2 });
        }
        yield* Console3.log("\u{1F50D} Cache miss, fetching from Google Flights");
        const flightData = [{
          date: departDate,
          from_airport: from,
          to_airport: to,
          max_stops: filters.max_stops,
          airlines: filters.airlines
        }];
        if (tripType === "round-trip" && returnDate) {
          flightData.push({
            date: returnDate,
            from_airport: to,
            to_airport: from,
            max_stops: filters.max_stops,
            airlines: filters.airlines
          });
        }
        const tfs = yield* encodeFlightSearch(flightData, tripType, seatClass, passengerCounts);
        const params = new URLSearchParams({ tfs, hl: "en", tfu: "EgQIABABIgA" });
        if (curr) params.set("curr", curr);
        const url = `https://www.google.com/travel/flights?${params.toString()}`;
        yield* Console3.log(`\u{1F680} Fetching flights via HTTP: ${url.substring(0, 100)}...`);
        const html = yield* fetchFlightsHtml2(url).pipe(
          Effect8.provide(Layer4.succeed(RateLimiterService, rateLimiter)),
          Effect8.provide(Layer4.succeed(HttpClient2.HttpClient, httpClient)),
          Effect8.tap((html2) => Console3.log(`\u{1F4C4} Received ${html2.length} bytes of HTML`))
        );
        const result = yield* extractJavaScriptData2(html).pipe(
          Effect8.tap((r) => Console3.log(`\u2708\uFE0F  Extracted ${r.flights.length} raw flight entries`))
        );
        if (result.current_price) {
          yield* Console3.log(`\u{1F4B0} Price indicator: ${result.current_price}`);
        }
        yield* cache.set(cacheKey, result).pipe(
          Effect8.tap(() => Console3.log("\u{1F4BE} Cached search results"))
        );
        const filteredFlights = filterFlights2(result.flights, filters);
        const sortedFlights = sortFlights2(filteredFlights, sortOption);
        const limitedFlights = typeof filters.limit === "number" ? sortedFlights.slice(0, filters.limit) : sortedFlights;
        return new Result({ current_price: result.current_price, flights: limitedFlights });
      })
    });
  })
);

// src/api/server-hono.ts
import { Schema as Schema3 } from "@effect/schema";
var ApiError = class extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
    this.name = "ApiError";
  }
};
var FlightSearchQuerySchema = Schema3.Struct({
  from: Schema3.String.pipe(Schema3.length(3), Schema3.pattern(/^[A-Z]{3}$/)),
  to: Schema3.String.pipe(Schema3.length(3), Schema3.pattern(/^[A-Z]{3}$/)),
  departDate: Schema3.String.pipe(Schema3.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  tripType: Schema3.optional(TripTypeSchema),
  returnDate: Schema3.optional(Schema3.String.pipe(Schema3.pattern(/^\d{4}-\d{2}-\d{2}$/))),
  sort: Schema3.optional(SortOptionSchema),
  seat: Schema3.optional(SeatClassSchema),
  currency: Schema3.optional(Schema3.String),
  // Passengers
  adults: Schema3.optional(Schema3.Number.pipe(Schema3.int(), Schema3.positive())),
  children: Schema3.optional(Schema3.Number.pipe(Schema3.int(), Schema3.nonNegative())),
  infantsInSeat: Schema3.optional(Schema3.Number.pipe(Schema3.int(), Schema3.nonNegative())),
  infantsOnLap: Schema3.optional(Schema3.Number.pipe(Schema3.int(), Schema3.nonNegative())),
  // Filters
  maxPrice: Schema3.optional(Schema3.Number.pipe(Schema3.positive())),
  minPrice: Schema3.optional(Schema3.Number.pipe(Schema3.positive())),
  maxDurationMinutes: Schema3.optional(Schema3.Number.pipe(Schema3.positive())),
  airlines: Schema3.optional(Schema3.Array(Schema3.String)),
  nonstopOnly: Schema3.optional(Schema3.Boolean),
  maxStops: Schema3.optional(Schema3.Number.pipe(Schema3.int(), Schema3.between(0, 2))),
  limit: Schema3.optional(Schema3.Union(Schema3.Number.pipe(Schema3.int(), Schema3.positive()), Schema3.Literal("all")))
});
var applyDefaults = (query) => ({
  ...query,
  tripType: query.tripType || "one-way",
  sort: query.sort || "price-asc",
  seat: query.seat || "economy",
  adults: query.adults ?? 1,
  children: query.children ?? 0,
  infantsInSeat: query.infantsInSeat ?? 0,
  infantsOnLap: query.infantsOnLap ?? 0
});
var createSearchCacheKey = (query, filters) => {
  const filterStr = JSON.stringify({
    maxPrice: filters.maxPrice,
    minPrice: filters.minPrice,
    maxDurationMinutes: filters.maxDurationMinutes,
    airlines: filters.airlines?.sort(),
    nonstopOnly: filters.nonstopOnly,
    max_stops: filters.max_stops,
    limit: filters.limit
  });
  return `${createCacheKey(
    query.from,
    query.to,
    query.departDate,
    query.tripType,
    query.returnDate,
    query.seat,
    query.adults,
    query.children,
    query.infantsInSeat,
    query.infantsOnLap
  )}|${query.sort}|${filterStr}`;
};
var apiKeyMiddleware = (expectedApiKey) => {
  return async (c, next) => {
    const apiKey = c.req.header("x-api-key") || c.req.header("X-Api-Key");
    if (!apiKey || apiKey !== expectedApiKey) {
      return c.json(
        {
          error: {
            reason: "Unauthorized",
            message: apiKey ? "Invalid API key. Please provide a valid x-api-key header." : "Missing x-api-key header. Please provide a valid API key."
          }
        },
        401
      );
    }
    await next();
  };
};
var parseQueryParams = async (c) => {
  const query = c.req.query();
  const transformed = {
    from: query.from?.toUpperCase(),
    to: query.to?.toUpperCase(),
    departDate: query.departDate || query.depart_date,
    tripType: query.tripType || query.trip_type,
    returnDate: query.returnDate || query.return_date,
    sort: query.sort,
    seat: query.seat,
    currency: query.currency,
    adults: query.adults ? parseInt(query.adults, 10) : void 0,
    children: query.children ? parseInt(query.children, 10) : void 0,
    infantsInSeat: query.infantsInSeat || query.infants_in_seat ? parseInt(query.infantsInSeat || query.infants_in_seat || "0", 10) : void 0,
    infantsOnLap: query.infantsOnLap || query.infants_on_lap ? parseInt(query.infantsOnLap || query.infants_on_lap || "0", 10) : void 0,
    maxPrice: query.maxPrice || query.max_price ? parseFloat(query.maxPrice || query.max_price || "0") : void 0,
    minPrice: query.minPrice || query.min_price ? parseFloat(query.minPrice || query.min_price || "0") : void 0,
    maxDurationMinutes: query.maxDurationMinutes || query.max_duration_minutes ? parseInt(query.maxDurationMinutes || query.max_duration_minutes || "0", 10) : void 0,
    airlines: query.airlines ? query.airlines.split(",").map((a) => a.trim()).filter(Boolean) : void 0,
    nonstopOnly: query.nonstopOnly === "true" || query.nonstop_only === "true" ? true : query.nonstopOnly === "false" || query.nonstop_only === "false" ? false : void 0,
    maxStops: query.maxStops || query.max_stops ? parseInt(query.maxStops || query.max_stops || "0", 10) : void 0,
    limit: query.limit === "all" ? "all" : query.limit ? parseInt(query.limit, 10) : void 0
  };
  Object.keys(transformed).forEach((key) => {
    if (transformed[key] === void 0) {
      delete transformed[key];
    }
  });
  const parsed = await Schema3.decodeUnknown(FlightSearchQuerySchema)(transformed).pipe(
    Effect9.runPromise
  ).catch((error) => {
    throw new ApiError("BadRequest", `Invalid query parameters: ${String(error)}`);
  });
  return applyDefaults(parsed);
};
var parseJsonBody = async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ApiError("BadRequest", "Invalid JSON body");
  });
  const parsed = await Schema3.decodeUnknown(FlightSearchQuerySchema)(body).pipe(
    Effect9.runPromise
  ).catch((error) => {
    throw new ApiError("BadRequest", `Invalid request body: ${String(error)}`);
  });
  return applyDefaults(parsed);
};
var handleScraperError = (error) => {
  const statusCode = error.reason === "InvalidInput" ? 400 : error.reason === "RateLimitExceeded" ? 429 : error.reason === "Timeout" ? 504 : 500;
  return {
    error: {
      reason: error.reason,
      message: error.message
    },
    statusCode
  };
};
var apiCacheConfig = {
  ttl: 30 * 60 * 1e3,
  // 30 minutes (more aggressive than default 15 min)
  maxSize: 500
  // Larger cache size for API
};
var createApp = (apiKey, scraperService, cacheService) => {
  const app = new Hono();
  app.use("*", apiKeyMiddleware(apiKey));
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.get("/api/example", (c) => {
    return c.json({
      message: "Hello from Hono API!",
      path: c.req.path,
      method: c.req.method
    });
  });
  app.get("/api/flights", async (c) => {
    try {
      const query = await parseQueryParams(c);
      const filters = {
        maxPrice: query.maxPrice,
        minPrice: query.minPrice,
        maxDurationMinutes: query.maxDurationMinutes,
        airlines: query.airlines,
        nonstopOnly: query.nonstopOnly,
        max_stops: query.maxStops,
        limit: query.limit
      };
      const passengers = {
        adults: query.adults,
        children: query.children,
        infants_in_seat: query.infantsInSeat,
        infants_on_lap: query.infantsOnLap
      };
      const cacheKey = createSearchCacheKey(query, filters);
      const cached = await cacheService.get(cacheKey).pipe(Effect9.runPromise);
      if (cached) {
        return c.json(
          {
            success: true,
            data: cached,
            cached: true
          },
          200,
          {
            "Cache-Control": "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600",
            "X-Cache": "HIT"
          }
        );
      }
      const result = await scraperService.scrape(
        query.from,
        query.to,
        query.departDate,
        query.tripType,
        query.returnDate,
        query.sort,
        filters,
        query.seat,
        passengers,
        query.currency
      ).pipe(Effect9.runPromise);
      await cacheService.set(cacheKey, result).pipe(Effect9.runPromise);
      return c.json(
        {
          success: true,
          data: result,
          cached: false
        },
        200,
        {
          "Cache-Control": "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600",
          "X-Cache": "MISS"
        }
      );
    } catch (error) {
      if (error instanceof ScraperError) {
        const { error: errorBody, statusCode } = handleScraperError(error);
        return c.json(errorBody, statusCode);
      }
      if (error instanceof ApiError) {
        const statusCode = error.reason === "Unauthorized" ? 401 : error.reason === "BadRequest" ? 400 : error.reason === "NotFound" ? 404 : 500;
        return c.json(
          {
            error: {
              reason: error.reason,
              message: error.message
            }
          },
          statusCode
        );
      }
      return c.json(
        {
          error: {
            reason: "InternalError",
            message: String(error)
          }
        },
        500
      );
    }
  });
  app.post("/api/flights", async (c) => {
    try {
      const body = await parseJsonBody(c);
      const filters = {
        maxPrice: body.maxPrice,
        minPrice: body.minPrice,
        maxDurationMinutes: body.maxDurationMinutes,
        airlines: body.airlines,
        nonstopOnly: body.nonstopOnly,
        max_stops: body.maxStops,
        limit: body.limit
      };
      const passengers = {
        adults: body.adults,
        children: body.children,
        infants_in_seat: body.infantsInSeat,
        infants_on_lap: body.infantsOnLap
      };
      const cacheKey = createSearchCacheKey(body, filters);
      const cached = await cacheService.get(cacheKey).pipe(Effect9.runPromise);
      if (cached) {
        return c.json(
          {
            success: true,
            data: cached,
            cached: true
          },
          200,
          {
            "Cache-Control": "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600",
            "X-Cache": "HIT"
          }
        );
      }
      const result = await scraperService.scrape(
        body.from,
        body.to,
        body.departDate,
        body.tripType,
        body.returnDate,
        body.sort,
        filters,
        body.seat,
        passengers,
        body.currency
      ).pipe(Effect9.runPromise);
      await cacheService.set(cacheKey, result).pipe(Effect9.runPromise);
      return c.json(
        {
          success: true,
          data: result,
          cached: false
        },
        200,
        {
          "Cache-Control": "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600",
          "X-Cache": "MISS"
        }
      );
    } catch (error) {
      if (error instanceof ScraperError) {
        const { error: errorBody, statusCode } = handleScraperError(error);
        return c.json(errorBody, statusCode);
      }
      if (error instanceof ApiError) {
        const statusCode = error.reason === "Unauthorized" ? 401 : error.reason === "BadRequest" ? 400 : error.reason === "NotFound" ? 404 : 500;
        return c.json(
          {
            error: {
              reason: error.reason,
              message: error.message
            }
          },
          statusCode
        );
      }
      return c.json(
        {
          error: {
            reason: "InternalError",
            message: String(error)
          }
        },
        500
      );
    }
  });
  app.notFound((c) => {
    return c.json(
      {
        error: {
          reason: "NotFound",
          message: `Route ${c.req.method} ${c.req.path} not found`
        }
      },
      404
    );
  });
  return app;
};
var initializeServices = async () => {
  console.log(`\u{1F4BE} Aggressive caching enabled (TTL: ${apiCacheConfig.ttl / 1e3 / 60} min, Max size: ${apiCacheConfig.maxSize})`);
  const cacheLayer = CacheLive(apiCacheConfig);
  const rateLimiterLayer = RateLimiterLive(defaultRateLimiterConfig);
  const scraperLayer = ScraperProductionLive.pipe(
    Layer5.provide(cacheLayer),
    Layer5.provide(rateLimiterLayer),
    Layer5.provide(FetchHttpClient.layer)
  );
  const { scraperService, cacheService } = await Effect9.gen(function* () {
    const scraper = yield* ScraperService;
    const cache = yield* CacheService;
    return { scraperService: scraper, cacheService: cache };
  }).pipe(
    Effect9.provide(scraperLayer),
    Effect9.provide(cacheLayer),
    Effect9.runPromise
  );
  return { scraperService, cacheService };
};
var createServerlessHandler = async (apiKey) => {
  console.log(`\u{1F511} API key validation enabled`);
  const { scraperService, cacheService } = await initializeServices();
  const app = createApp(apiKey, scraperService, cacheService);
  return app.fetch;
};

// src/api/vercel.ts
var API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error("API_KEY environment variable is required");
}
var handler = null;
async function vercelHandler(req) {
  if (!handler) {
    console.log(`Initializing REST API server for Vercel...`);
    console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
    handler = await createServerlessHandler(API_KEY);
    console.log(`Server initialized`);
  }
  return handler(req);
}
export {
  vercelHandler as default
};
