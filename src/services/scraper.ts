/**
 * ScraperService interface definition
 * This is the contract that all scraper implementations must follow
 */

import { Effect, Context } from "effect"
import { Result, ScraperError, SortOption, FlightFilters, TripType, SeatClass, Passengers } from "../domain"

/**
 * Service Definition for flight scraping operations
 */
export interface ScraperService {
  readonly scrape: (
    from: string,
    to: string,
    departDate: string,
    tripType: TripType,
    returnDate: string | undefined,
    sortOption: SortOption,
    filters: FlightFilters,
    seat?: SeatClass,
    passengers?: Passengers,
    currency?: string
  ) => Effect.Effect<Result, ScraperError>
}

export const ScraperService = Context.GenericTag<ScraperService>("ScraperService")

