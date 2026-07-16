/**
 * Custom error types for scraper operations
 */

import { Schema } from "effect"

/** Custom Error Type for scraper operations */
export class ScraperError extends Schema.TaggedErrorClass<ScraperError>()("ScraperError", {
  reason: Schema.Literals(["NavigationFailed", "Timeout", "ParsingError", "Unknown", "InvalidInput", "RateLimitExceeded"]),
  message: Schema.String,
}) {}

/**
 * Helpers for constructing ScraperErrors with concise, diagnostic messages.
 * User-facing guidance belongs in the CLI/TUI presentation layer, keyed off
 * `reason`, not in the domain error itself.
 */
export const ScraperErrors = {
  navigationFailed: (url: string, details: string) =>
    new ScraperError({
      reason: "NavigationFailed",
      message: `Failed to fetch ${url}: ${details}`,
    }),

  timeout: (operation: string) =>
    new ScraperError({
      reason: "Timeout",
      message: `Operation timed out: ${operation}`,
    }),

  parsingError: (details: string) =>
    new ScraperError({
      reason: "ParsingError",
      message: `Failed to parse flight data: ${details}`,
    }),

  invalidInput: (field: string, reason: string) =>
    new ScraperError({
      reason: "InvalidInput",
      message: `Invalid input for ${field}: ${reason}`,
    }),

  rateLimitExceeded: (waitTimeSeconds: number) =>
    new ScraperError({
      reason: "RateLimitExceeded",
      message: `Rate limit exceeded; wait ${waitTimeSeconds}s before retrying`,
    }),

  unknown: (error: unknown) =>
    new ScraperError({
      reason: "Unknown",
      message: `Unexpected error: ${String(error)}`,
    }),
}
