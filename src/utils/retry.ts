/**
 * Retry logic with exponential backoff for Effect operations
 */

import { Effect, Schedule, Duration } from "effect"
import { ScraperError } from "../domain"

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts?: number
  /** Initial delay in milliseconds */
  initialDelay?: number
  /** Maximum delay in milliseconds */
  maxDelay?: number
  /** Backoff factor (multiplier for each retry) */
  backoffFactor?: number
}

/**
 * Default retry configuration
 */
export const defaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,    // 1 second
  maxDelay: 30000,       // 30 seconds
  backoffFactor: 2
}

/**
 * Creates a retry schedule with exponential backoff
 */
export const createRetrySchedule = (config: RetryConfig = defaultRetryConfig) => {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2
  } = config

  return Schedule.exponential(Duration.millis(initialDelay), backoffFactor)
    .pipe(
      Schedule.either(Schedule.spaced(Duration.millis(maxDelay))),
      Schedule.compose(Schedule.elapsed),
      Schedule.whileOutput(Duration.lessThanOrEqualTo(Duration.millis(maxDelay))),
      Schedule.intersect(Schedule.recurs(maxAttempts - 1))
    )
}

/**
 * Checks if an error is retryable
 */
export const isRetryableError = (error: ScraperError): boolean => {
  // Retry on network/navigation failures and timeouts
  // Don't retry on parsing errors (likely a code issue) or invalid input
  return error.reason === "NavigationFailed" || error.reason === "Timeout"
}

/**
 * Wraps an Effect with retry logic
 */
export const withRetry = <A, E extends ScraperError, R>(
  effect: Effect.Effect<A, E, R>,
  config: RetryConfig = defaultRetryConfig
): Effect.Effect<A, E, R> => {
  const policy = createRetrySchedule(config)
  
  return effect.pipe(
    Effect.retry({
      schedule: policy,
      while: (error: E) => isRetryableError(error)
    })
  )
}

/**
 * Wraps an Effect with retry logic and logging
 */
export const withRetryAndLog = <A, E extends ScraperError, R>(
  effect: Effect.Effect<A, E, R>,
  operationName: string,
  config: RetryConfig = defaultRetryConfig
): Effect.Effect<A, E, R> => {
  const policy = createRetrySchedule(config)
  
  return effect.pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`${operationName} failed: ${error.message}. Retrying...`)
    ),
    Effect.retry({
      schedule: policy,
      while: (error: E) => isRetryableError(error)
    }),
    Effect.tapError((error) =>
      Effect.logError(`${operationName} failed after all retries: ${error.message}`)
    )
  )
}

