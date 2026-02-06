/**
 * REST API Server using Hono and Bun
 * Requires x-api-key header matching API_KEY from .env
 */

import { Hono } from "hono"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { ScraperService, ScraperProtobufLive, ScraperProductionLive } from "../services"
import { ScraperError } from "../domain/errors"
import { TripTypeSchema, SeatClassSchema, SortOptionSchema } from "../domain"
import { Schema } from "@effect/schema"
import { CacheService, CacheLive, createCacheKey, defaultCacheConfig } from "../utils/cache"
import { RateLimiterService, RateLimiterLive, defaultRateLimiterConfig } from "../utils/rate-limiter"

/**
 * API Error for authentication failures
 */
export class ApiError extends Error {
  constructor(
    public reason: "Unauthorized" | "BadRequest" | "NotFound" | "InternalError",
    message: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * Request schema for flight search
 */
const FlightSearchQuerySchema = Schema.Struct({
  from: Schema.String.pipe(Schema.length(3), Schema.pattern(/^[A-Z]{3}$/)),
  to: Schema.String.pipe(Schema.length(3), Schema.pattern(/^[A-Z]{3}$/)),
  departDate: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
  tripType: Schema.optional(TripTypeSchema),
  returnDate: Schema.optional(Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/))),
  sort: Schema.optional(SortOptionSchema),
  seat: Schema.optional(SeatClassSchema),
  currency: Schema.optional(Schema.String),
  // Passengers
  adults: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  children: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  infantsInSeat: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  infantsOnLap: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  // Filters
  maxPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  minPrice: Schema.optional(Schema.Number.pipe(Schema.positive())),
  maxDurationMinutes: Schema.optional(Schema.Number.pipe(Schema.positive())),
  airlines: Schema.optional(Schema.Array(Schema.String)),
  nonstopOnly: Schema.optional(Schema.Boolean),
  maxStops: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 2))),
  limit: Schema.optional(Schema.Union(Schema.Number.pipe(Schema.int(), Schema.positive()), Schema.Literal("all")))
})

type FlightSearchQueryRaw = Schema.Schema.Type<typeof FlightSearchQuerySchema>

/**
 * Apply defaults to parsed query parameters
 */
const applyDefaults = (query: FlightSearchQueryRaw) => ({
  ...query,
  tripType: query.tripType || "one-way",
  sort: query.sort || "price-asc",
  seat: query.seat || "economy",
  adults: query.adults ?? 1,
  children: query.children ?? 0,
  infantsInSeat: query.infantsInSeat ?? 0,
  infantsOnLap: query.infantsOnLap ?? 0
})

type FlightSearchQuery = ReturnType<typeof applyDefaults>

/**
 * Create cache key from search query including filters and sort
 */
const createSearchCacheKey = (query: FlightSearchQuery, filters: any): string => {
  const filterStr = JSON.stringify({
    maxPrice: filters.maxPrice,
    minPrice: filters.minPrice,
    maxDurationMinutes: filters.maxDurationMinutes,
    airlines: filters.airlines?.sort(),
    nonstopOnly: filters.nonstopOnly,
    max_stops: filters.max_stops,
    limit: filters.limit
  })
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
    query.infantsOnLap,
    query.currency || "USD"
  )}|${query.sort}|${filterStr}`
}

/**
 * Middleware to validate API key
 */
const apiKeyMiddleware = (expectedApiKey: string) => {
  return async (c: any, next: () => Promise<void>) => {
    const apiKey = c.req.header("x-api-key") || c.req.header("X-Api-Key")

    if (!apiKey || apiKey !== expectedApiKey) {
      return c.json(
        {
          error: {
            reason: "Unauthorized",
            message: apiKey
              ? "Invalid API key. Please provide a valid x-api-key header."
              : "Missing x-api-key header. Please provide a valid API key."
          }
        },
        401
      )
    }

    await next()
  }
}

/**
 * Parse and validate query parameters
 */
const parseQueryParams = async (c: any): Promise<FlightSearchQuery> => {
  const query = c.req.query()
  const transformed: Record<string, any> = {
    from: query.from?.toUpperCase(),
    to: query.to?.toUpperCase(),
    departDate: query.departDate || query.depart_date,
    tripType: query.tripType || query.trip_type,
    returnDate: query.returnDate || query.return_date,
    sort: query.sort,
    seat: query.seat,
    currency: query.currency,
    adults: query.adults ? parseInt(query.adults, 10) : undefined,
    children: query.children ? parseInt(query.children, 10) : undefined,
    infantsInSeat: query.infantsInSeat || query.infants_in_seat
      ? parseInt(query.infantsInSeat || query.infants_in_seat || "0", 10)
      : undefined,
    infantsOnLap: query.infantsOnLap || query.infants_on_lap
      ? parseInt(query.infantsOnLap || query.infants_on_lap || "0", 10)
      : undefined,
    maxPrice: query.maxPrice || query.max_price
      ? parseFloat(query.maxPrice || query.max_price || "0")
      : undefined,
    minPrice: query.minPrice || query.min_price
      ? parseFloat(query.minPrice || query.min_price || "0")
      : undefined,
    maxDurationMinutes: query.maxDurationMinutes || query.max_duration_minutes
      ? parseInt(query.maxDurationMinutes || query.max_duration_minutes || "0", 10)
      : undefined,
    airlines: query.airlines ? query.airlines.split(",").map((a: string) => a.trim()).filter(Boolean) : undefined,
    nonstopOnly:
      query.nonstopOnly === "true" || query.nonstop_only === "true"
        ? true
        : query.nonstopOnly === "false" || query.nonstop_only === "false"
        ? false
        : undefined,
    maxStops: query.maxStops || query.max_stops ? parseInt(query.maxStops || query.max_stops || "0", 10) : undefined,
    limit: query.limit === "all" ? "all" : query.limit ? parseInt(query.limit, 10) : undefined
  }

  // Remove undefined values
  Object.keys(transformed).forEach((key) => {
    if (transformed[key] === undefined) {
      delete transformed[key]
    }
  })

  const parsed = await Schema.decodeUnknown(FlightSearchQuerySchema)(transformed).pipe(
    Effect.runPromise
  ).catch((error) => {
    throw new ApiError("BadRequest", `Invalid query parameters: ${String(error)}`)
  })

  return applyDefaults(parsed)
}

/**
 * Parse and validate JSON body
 */
const parseJsonBody = async (c: any): Promise<FlightSearchQuery> => {
  const body = await c.req.json().catch(() => {
    throw new ApiError("BadRequest", "Invalid JSON body")
  })

  const parsed = await Schema.decodeUnknown(FlightSearchQuerySchema)(body).pipe(
    Effect.runPromise
  ).catch((error) => {
    throw new ApiError("BadRequest", `Invalid request body: ${String(error)}`)
  })

  return applyDefaults(parsed)
}

/**
 * Convert ScraperError to HTTP error response
 */
const handleScraperError = (error: ScraperError) => {
  const statusCode =
    error.reason === "InvalidInput"
      ? 400
      : error.reason === "RateLimitExceeded"
      ? 429
      : error.reason === "Timeout"
      ? 504
      : 500

  return {
    error: {
      reason: error.reason,
      message: error.message
    },
    statusCode
  }
}

/**
 * Aggressive cache configuration for API
 */
const apiCacheConfig = {
  ttl: 30 * 60 * 1000, // 30 minutes (more aggressive than default 15 min)
  maxSize: 500 // Larger cache size for API
}

/**
 * Create Hono app with routes
 */
export const createApp = (
  apiKey: string,
  scraperService: ScraperService,
  cacheService: CacheService
) => {
  const app = new Hono()

  // Apply API key middleware to all routes
  app.use("*", apiKeyMiddleware(apiKey))

  // Health check endpoint
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString()
    })
  })

  // Example endpoint
  app.get("/api/example", (c) => {
    return c.json({
      message: "Hello from Hono API!",
      path: c.req.path,
      method: c.req.method
    })
  })

  // GET /api/flights - Search flights via query parameters
  app.get("/api/flights", async (c) => {
    try {
      const query = await parseQueryParams(c)

      const filters = {
        maxPrice: query.maxPrice,
        minPrice: query.minPrice,
        maxDurationMinutes: query.maxDurationMinutes,
        airlines: query.airlines,
        nonstopOnly: query.nonstopOnly,
        max_stops: query.maxStops,
        limit: query.limit
      }

      const passengers = {
        adults: query.adults,
        children: query.children,
        infants_in_seat: query.infantsInSeat,
        infants_on_lap: query.infantsOnLap
      }

      // Create cache key including filters and sort
      const cacheKey = createSearchCacheKey(query, filters)

      // Check cache first
      const cached = await cacheService.get(cacheKey).pipe(Effect.runPromise)
      if (cached) {
        // Return cached result with aggressive cache headers
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
        )
      }

      // Cache miss - fetch from scraper
      const result = await scraperService
        .scrape(
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
        )
        .pipe(Effect.runPromise)

      // Store in cache
      await cacheService.set(cacheKey, result).pipe(Effect.runPromise)

      // Return with cache headers
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
      )
    } catch (error) {
      if (error instanceof ScraperError) {
        const { error: errorBody, statusCode } = handleScraperError(error)
        return c.json(errorBody, statusCode)
      }
      if (error instanceof ApiError) {
        const statusCode =
          error.reason === "Unauthorized"
            ? 401
            : error.reason === "BadRequest"
            ? 400
            : error.reason === "NotFound"
            ? 404
            : 500
        return c.json(
          {
            error: {
              reason: error.reason,
              message: error.message
            }
          },
          statusCode
        )
      }
      return c.json(
        {
          error: {
            reason: "InternalError",
            message: String(error)
          }
        },
        500
      )
    }
  })

  // POST /api/flights - Search flights via JSON body
  app.post("/api/flights", async (c) => {
    try {
      const body = await parseJsonBody(c)

      const filters = {
        maxPrice: body.maxPrice,
        minPrice: body.minPrice,
        maxDurationMinutes: body.maxDurationMinutes,
        airlines: body.airlines,
        nonstopOnly: body.nonstopOnly,
        max_stops: body.maxStops,
        limit: body.limit
      }

      const passengers = {
        adults: body.adults,
        children: body.children,
        infants_in_seat: body.infantsInSeat,
        infants_on_lap: body.infantsOnLap
      }

      // Create cache key including filters and sort
      const cacheKey = createSearchCacheKey(body, filters)

      // Check cache first
      const cached = await cacheService.get(cacheKey).pipe(Effect.runPromise)
      if (cached) {
        // Return cached result with aggressive cache headers
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
        )
      }

      // Cache miss - fetch from scraper
      const result = await scraperService
        .scrape(
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
        )
        .pipe(Effect.runPromise)

      // Store in cache
      await cacheService.set(cacheKey, result).pipe(Effect.runPromise)

      // Return with cache headers
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
      )
    } catch (error) {
      if (error instanceof ScraperError) {
        const { error: errorBody, statusCode } = handleScraperError(error)
        return c.json(errorBody, statusCode)
      }
      if (error instanceof ApiError) {
        const statusCode =
          error.reason === "Unauthorized"
            ? 401
            : error.reason === "BadRequest"
            ? 400
            : error.reason === "NotFound"
            ? 404
            : 500
        return c.json(
          {
            error: {
              reason: error.reason,
              message: error.message
            }
          },
          statusCode
        )
      }
      return c.json(
        {
          error: {
            reason: "InternalError",
            message: String(error)
          }
        },
        500
      )
    }
  })

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: {
          reason: "NotFound",
          message: `Route ${c.req.method} ${c.req.path} not found`
        }
      },
      404
    )
  })

  return app
}

/**
 * Initialize services (cache, scraper, etc.)
 * This is separated so it can be reused in serverless environments.
 *
 * Uses Layer.provideMerge so that CacheService is a single shared instance
 * consumed by both ScraperProductionLive and the API handlers.
 */
export const initializeServices = async () => {
  console.log(`💾 Aggressive caching enabled (TTL: ${apiCacheConfig.ttl / 1000 / 60} min, Max size: ${apiCacheConfig.maxSize})`)

  // Build a unified layer where CacheService is shared (not duplicated)
  // provideMerge provides the dep to ScraperProductionLive AND passes it through
  const appLayer = ScraperProductionLive.pipe(
    Layer.provideMerge(CacheLive(apiCacheConfig)),
    Layer.provide(RateLimiterLive(defaultRateLimiterConfig)),
    Layer.provide(FetchHttpClient.layer)
  )

  const { scraperService, cacheService } = await Effect.gen(function* () {
    const scraper = yield* ScraperService
    const cache = yield* CacheService
    return { scraperService: scraper, cacheService: cache }
  }).pipe(
    Effect.provide(appLayer),
    Effect.runPromise
  )

  return { scraperService, cacheService }
}

/**
 * Start the server (for Bun/Node.js)
 */
export const startServer = async (port: number = 3000, apiKey: string) => {
  console.log(`🚀 Starting HTTP server on port ${port}`)
  console.log(`🔑 API key validation enabled`)

  const { scraperService, cacheService } = await initializeServices()

  // Create Hono app with cache service
  const app = createApp(apiKey, scraperService, cacheService)

  // Start server
  return Bun.serve({
    port,
    fetch: app.fetch
  })
}

/**
 * Create serverless handler (for Vercel/Edge)
 */
export const createServerlessHandler = async (apiKey: string) => {
  console.log(`🔑 API key validation enabled`)

  const { scraperService, cacheService } = await initializeServices()

  // Create Hono app with cache service
  const app = createApp(apiKey, scraperService, cacheService)

  // Return fetch handler for serverless
  return app.fetch
}
