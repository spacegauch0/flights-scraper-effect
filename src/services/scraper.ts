/**
 * ScraperService interface definition
 * This is the contract that all scraper implementations must follow
 */

import { Effect, Context } from "effect"
import { Result, ScraperError, ScrapeRequest } from "../domain"

/**
 * Service Definition for flight scraping operations.
 * Callers construct a validated ScrapeRequest (decode untrusted input against
 * ScrapeRequestSchema at the boundary) and receive a parsed Result.
 */
export class ScraperService extends Context.Service<ScraperService, {
  readonly scrape: (request: ScrapeRequest) => Effect.Effect<Result, ScraperError>
}>()("ScraperService") {}
