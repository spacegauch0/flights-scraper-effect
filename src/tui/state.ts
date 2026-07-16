/**
 * Shared TUI state shapes.
 */

import type { FlightOption } from "../domain"
import type { MultiCityLegOption, MultiCitySession } from "../services"

/** Multi-city supports up to this many legs beyond the first (origin/destination/departDate) */
export const MAX_ADDITIONAL_LEGS = 3

/**
 * An additional leg as typed into the form - raw strings, validated (and
 * branded into a FlightLeg) only when the search request is decoded.
 */
export interface LegDraft {
  readonly from: string
  readonly to: string
  readonly date: string
}

/**
 * Tracks an in-progress interactive multi-city selection: the user picks a
 * flight from the current leg's real options (shown in the results table),
 * which reveals the next leg's options, until every leg is chosen.
 */
export interface MultiCityFlowState {
  readonly session: MultiCitySession
  /** Bookable options for the leg the user is currently choosing */
  readonly options: readonly MultiCityLegOption[]
  /** Flights already chosen for completed legs, in leg order */
  readonly chosenFlights: readonly FlightOption[]
}
