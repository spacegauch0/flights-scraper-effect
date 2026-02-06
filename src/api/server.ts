/**
 * REST API Server using Effect HTTP and Bun
 * Requires x-api-key header matching API_KEY from .env
 */

import { Effect, Layer, Context } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse, HttpClient, FetchHttpClient } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Schema } from "@effect/schema"
import { ScraperService, ScraperProtobufLive } from "../services"
import { ScraperError } from "../domain/errors"
import { TripTypeSchema, SeatClassSchema, SortOptionSchema, FlightFiltersSchema, PassengersSchema } from "../domain"

/**
 * API Error for authentication failures
 */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  reason: Schema.Literal("Unauthorized", "BadRequest", "NotFound", "InternalError"),
  message: Schema.String
}) {}

/**
 * API Key Service - validates API keys from environment
 */
export interface ApiKeyService {
  readonly validate: (apiKey: string) => Effect.Effect<boolean, ApiError>
}

export const ApiKeyService = Context.GenericTag<ApiKeyService>("ApiKeyService")

/**
 * API Key Service implementation
 */
const ApiKeyServiceLive = (expectedApiKey: string): Layer.Layer<ApiKeyService> =>
  Layer.succeed(
    ApiKeyService,
    ApiKeyService.of({
      validate: (apiKey: string) =>
        Effect.succeed(apiKey === expectedApiKey).pipe(
          Effect.flatMap((isValid) =>
            isValid
              ? Effect.succeed(true)
              : Effect.fail(
                  new ApiError({
                    reason: "Unauthorized",
                    message: "Invalid API key. Please provide a valid x-api-key header."
                  })
                )
          )
        )
    })
  )

/**
 * Middleware to validate API key from request headers
 */
const validateApiKey = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<void, ApiError, ApiKeyService> =>
  Effect.gen(function* () {
    const apiKeyService = yield* ApiKeyService
    const apiKey = request.headers["x-api-key"] || request.headers["X-Api-Key"]

    if (!apiKey || typeof apiKey !== "string") {
      return yield* Effect.fail(
        new ApiError({
          reason: "Unauthorized",
          message: "Missing x-api-key header. Please provide a valid API key."
        })
      )
    }

    yield* apiKeyService.validate(apiKey)
  })

/**
 * Create error response
 */
const errorResponse = (error: ApiError): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.unsafeJson({
    error: {
      reason: error.reason,
      message: error.message
    }
  }).pipe(
    HttpServerResponse.status(
      error.reason === "Unauthorized" ? 401 : error.reason === "BadRequest" ? 400 : error.reason === "NotFound" ? 404 : 500
    )
  )

/**
 * Convert ScraperError to HTTP error response
 */
const scraperErrorResponse = (error: ScraperError): HttpServerResponse.HttpServerResponse => {
  const statusCode = 
    error.reason === "InvalidInput" ? 400 :
    error.reason === "RateLimitExceeded" ? 429 :
    error.reason === "Timeout" ? 504 :
    500

  return HttpServerResponse.unsafeJson({
    error: {
      reason: error.reason,
      message: error.message
    }
  }).pipe(HttpServerResponse.status(statusCode))
}

/**
 * Helper to wrap handlers with API key validation
 */
const withApiKeyValidation = <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R | ApiKeyService | HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    
    // Validate API key first - catch errors and return error response
    yield* validateApiKey(request).pipe(
      Effect.catchAll((error) => {
        if (error instanceof ApiError) {
          return Effect.fail(error)
        }
        return Effect.fail(
          new ApiError({
            reason: "InternalError",
            message: String(error)
          })
        )
      })
    )
    
    // If validation passes, run the handler
    return yield* handler
  }).pipe(
    Effect.catchAll((error) => {
      if (error instanceof ApiError) {
        return errorResponse(error)
      }
      if (error instanceof ScraperError) {
        return scraperErrorResponse(error)
      }
      return Effect.succeed(
        HttpServerResponse.json({
          error: {
            reason: "InternalError",
            message: String(error)
          }
        }).pipe(HttpServerResponse.status(500))
      )
    })
  )

/**
 * Health check endpoint - simplified for debugging
 */
const healthHandler: Effect.Effect<HttpServerResponse.HttpServerResponse, never, ApiKeyService | HttpServerRequest.HttpServerRequest> =
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    
    // Simple API key check
    const apiKey = request.headers["x-api-key"] || request.headers["X-Api-Key"]
    if (!apiKey || apiKey !== "your-api-key") {
      return HttpServerResponse.text(JSON.stringify({
        error: { reason: "Unauthorized", message: "Invalid API key" }
      })).pipe(
        HttpServerResponse.status(401),
        HttpServerResponse.header("Content-Type", "application/json")
      )
    }
    
    // Return success response
    return HttpServerResponse.text(JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString()
    })).pipe(
      HttpServerResponse.header("Content-Type", "application/json")
    )
  })

/**
 * Example API endpoint
 */
const exampleHandler = withApiKeyValidation(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return HttpServerResponse.json({
      message: "Hello from Effect HTTP API!",
      path: request.url,
      method: request.method
    })
  })
)

/**
 * Request schema for flight search (query parameters)
 * Note: Defaults are applied manually after parsing
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
const applyDefaults = (query: FlightSearchQueryRaw): FlightSearchQuery => ({
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
 * Parse query parameters from request URL
 */
const parseQueryParams = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<FlightSearchQuery, ApiError> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const params: Record<string, string | undefined> = {}
    
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value
    }

    // Transform camelCase query params to match schema
    const transformed: Record<string, any> = {
      from: params.from?.toUpperCase(),
      to: params.to?.toUpperCase(),
      departDate: params.departDate || params.depart_date,
      tripType: params.tripType || params.trip_type,
      returnDate: params.returnDate || params.return_date,
      sort: params.sort,
      seat: params.seat,
      currency: params.currency,
      adults: params.adults ? parseInt(params.adults, 10) : undefined,
      children: params.children ? parseInt(params.children, 10) : undefined,
      infantsInSeat: params.infantsInSeat || params.infants_in_seat ? parseInt(params.infantsInSeat || params.infants_in_seat || "0", 10) : undefined,
      infantsOnLap: params.infantsOnLap || params.infants_on_lap ? parseInt(params.infantsOnLap || params.infants_on_lap || "0", 10) : undefined,
      maxPrice: params.maxPrice || params.max_price ? parseFloat(params.maxPrice || params.max_price || "0") : undefined,
      minPrice: params.minPrice || params.min_price ? parseFloat(params.minPrice || params.min_price || "0") : undefined,
      maxDurationMinutes: params.maxDurationMinutes || params.max_duration_minutes ? parseInt(params.maxDurationMinutes || params.max_duration_minutes || "0", 10) : undefined,
      airlines: params.airlines ? params.airlines.split(",").map(a => a.trim()).filter(Boolean) : undefined,
      nonstopOnly: params.nonstopOnly || params.nonstop_only === "true" ? true : params.nonstopOnly === "false" || params.nonstop_only === "false" ? false : undefined,
      maxStops: params.maxStops || params.max_stops ? parseInt(params.maxStops || params.max_stops || "0", 10) : undefined,
      limit: params.limit === "all" ? "all" : params.limit ? parseInt(params.limit, 10) : undefined
    }

    // Remove undefined values
    Object.keys(transformed).forEach(key => {
      if (transformed[key] === undefined) {
        delete transformed[key]
      }
    })

    const parsed = yield* Schema.decodeUnknown(FlightSearchQuerySchema)(transformed).pipe(
      Effect.mapError((error) =>
        new ApiError({
          reason: "BadRequest",
          message: `Invalid query parameters: ${String(error)}`
        })
      )
    )

    // Apply defaults
    return applyDefaults(parsed)
  })

/**
 * Parse JSON body from request
 */
const parseJsonBody = (request: HttpServerRequest.HttpServerRequest, schema: typeof FlightSearchQuerySchema): Effect.Effect<FlightSearchQuery, ApiError> =>
  Effect.gen(function* () {
    const body = yield* request.json.pipe(
      Effect.mapError(() =>
        new ApiError({
          reason: "BadRequest",
          message: "Invalid JSON body"
        })
      )
    )

    const parsed = yield* Schema.decodeUnknown(schema)(body).pipe(
      Effect.mapError((error) =>
        new ApiError({
          reason: "BadRequest",
          message: `Invalid request body: ${String(error)}`
        })
      )
    )

    // Apply defaults
    return applyDefaults(parsed)
  })

/**
 * Flight search handler - converts query params to scraper call
 */
const flightSearchHandler = (
  query: FlightSearchQuery
): Effect.Effect<HttpServerResponse.HttpServerResponse, ScraperError, ScraperService> =>
  Effect.gen(function* () {
    const scraper = yield* ScraperService

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

    const result = yield* scraper.scrape(
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

    return yield* HttpServerResponse.json({
      success: true,
      data: result
    })
  })

/**
 * GET /api/flights - Search flights via query parameters
 */
const getFlightsHandler = withApiKeyValidation(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const query = yield* parseQueryParams(request)
    const response = yield* flightSearchHandler(query)
    return response
  }).pipe(
    Effect.catchAll((error) => {
      if (error instanceof ScraperError) {
        return Effect.succeed(scraperErrorResponse(error))
      }
      if (error instanceof ApiError) {
        return Effect.succeed(errorResponse(error))
      }
      return Effect.succeed(
        HttpServerResponse.unsafeJson({
          error: {
            reason: "InternalError",
            message: String(error)
          }
        }).pipe(HttpServerResponse.status(500))
      )
    })
  )
)

/**
 * POST /api/flights - Search flights via JSON body
 */
const postFlightsHandler = withApiKeyValidation(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* parseJsonBody(request, FlightSearchQuerySchema)
    const response = yield* flightSearchHandler(body)
    return response
  }).pipe(
    Effect.catchAll((error) => {
      if (error instanceof ScraperError) {
        return Effect.succeed(scraperErrorResponse(error))
      }
      if (error instanceof ApiError) {
        return Effect.succeed(errorResponse(error))
      }
      return Effect.succeed(
        HttpServerResponse.unsafeJson({
          error: {
            reason: "InternalError",
            message: String(error)
          }
        }).pipe(HttpServerResponse.status(500))
      )
    })
  )
)

/**
 * Main HTTP router with routes
 */
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/health", healthHandler),
  HttpRouter.get("/api/example", exampleHandler),
  HttpRouter.post("/api/example", exampleHandler),
  HttpRouter.get("/api/flights", getFlightsHandler),
  HttpRouter.post("/api/flights", postFlightsHandler),
  HttpRouter.catchAll((error) =>
    HttpServerResponse.unsafeJson({
      error: {
        reason: "InternalError",
        message: String(error)
      }
    }).pipe(HttpServerResponse.status(500))
  )
)

/**
 * Start the server
 */
export const startServer = (port: number = 3000, apiKey: string) =>
  Effect.gen(function* () {
    yield* Effect.log(`🚀 Starting HTTP server on port ${port}`)
    yield* Effect.log(`🔑 API key validation enabled`)

    const serverLayer = BunHttpServer.layer({ port })
    const httpApp = HttpRouter.toHttpApp(router)
    const serveLayer = HttpServer.serve(httpApp)

    // Provide scraper service with HttpClient
    const scraperLayer = ScraperProtobufLive.pipe(
      Layer.provide(FetchHttpClient.layer)
    )

    const appLayer = serveLayer.pipe(
      Layer.provide(serverLayer),
      Layer.provide(ApiKeyServiceLive(apiKey)),
      Layer.provide(scraperLayer)
    )

    yield* Layer.launch(appLayer)
    yield* HttpServer.logAddress
    yield* Effect.never
  })
