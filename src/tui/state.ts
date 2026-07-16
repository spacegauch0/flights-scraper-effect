/**
 * Shared TUI state shapes.
 */

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
