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
  /** Maximum delay in milliseconds (caps individual delays) */
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
 * Creates a retry schedule with exponential backoff, jitter, and a cap.
 *
 * - Exponential delays: initialDelay, initialDelay * factor, initialDelay * factor^2, ...
 * - Individual delays capped at maxDelay via union (takes the minimum of the two schedules)
 * - Jitter applied to avoid thundering herd across parallel instances
 * - Total attempts capped at maxAttempts (intersect with recurs)
 */
export const createRetrySchedule = (config: RetryConfig = defaultRetryConfig) => {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2
  } = config

  return Schedule.exponential(Duration.millis(initialDelay), backoffFactor).pipe(
    // Cap individual delay at maxDelay: union takes the shorter delay
    Schedule.union(Schedule.spaced(Duration.millis(maxDelay))),
    // Add +/- 20% jitter to prevent thundering herd
    Schedule.jittered,
    // Cap total number of retries
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
      while: (error: unknown): error is E => {
        return error instanceof ScraperError && isRetryableError(error)
      }
    })
  )
}

/**
 * Wraps an Effect with retry logic and structured logging.
 */
export const withRetryAndLog = <A, E extends ScraperError, R>(
  effect: Effect.Effect<A, E, R>,
  operationName: string,
  config: RetryConfig = defaultRetryConfig
): Effect.Effect<A, E, R> => {
  const policy = createRetrySchedule(config)

  return effect.pipe(
    Effect.tapError((error: E) =>
      Effect.logWarning(`${operationName} failed, will retry if retryable`).pipe(
        Effect.annotateLogs({ operation: operationName, reason: error.reason })
      )
    ),
    Effect.retry({
      schedule: policy,
      while: (error: unknown): error is E => {
        return error instanceof ScraperError && isRetryableError(error)
      }
    }),
    Effect.tapError((error: E) =>
      Effect.logError(`${operationName} failed after all retries`).pipe(
        Effect.annotateLogs({ operation: operationName, reason: error.reason })
      )
    )
  )
}

