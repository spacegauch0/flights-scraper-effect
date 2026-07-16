/**
 * The multi-city picker.
 *
 * Unlike one-way/round-trip, Google Flights has no single request that
 * returns a full multi-city itinerary with a total price - the real UI is a
 * step-by-step wizard: you pick a flight for leg 1, which reveals leg 2's
 * options (via the same internal GetShoppingResults endpoint, now carrying
 * leg 1's chosen flight token), and so on.
 *
 * The picker interface hides that machinery behind two steps:
 *
 * - `startMultiCityPicker(params)` returns the first `MultiCityStep`
 * - `chooseMultiCityOption(step, option)` advances to the next step
 *
 * A step is either `PickLeg` (here are this leg's bookable options - choose
 * one) or `Complete` (the finished itinerary, each flight paired with its
 * leg). RPC session values, selection tokens, and leg indexing are
 * implementation. `fetchMultiCityItinerary` is a greedy (cheapest-per-leg)
 * convenience built on the same steps, for non-interactive callers like the
 * CLI.
 *
 * Transport concerns (session values, request envelope, response envelope)
 * live in google-rpc.ts; this module owns only the GetShoppingResults
 * payload and response layout.
 */

import { Effect } from "effect"
import {
  AirportCode, DateString, FlightLeg, FlightOption, Passengers, Result, ScraperErrors, SeatClass,
  formatClock12, formatDesignator, formatDurationHrMin, parsePrice, type FlightDesignator
} from "../domain"
import { buildFlightUrl } from "../utils/protobuf"
import { callFlightsRpc, extractRpcSession, type RpcSession } from "./google-rpc"
import { fetchSearchPage } from "./search-page"

const SHOPPING_ENDPOINT = "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults"

export interface MultiCityParams {
  readonly from: AirportCode
  readonly to: AirportCode
  readonly departDate: DateString
  readonly additionalLegs: readonly FlightLeg[]
  readonly seat: SeatClass
  readonly passengers: Passengers
  readonly currency?: string
}

/** One bookable flight option for a leg, along with what's needed to select it */
export interface MultiCityLegOption {
  readonly flight: FlightOption
  readonly token: string
  readonly designator: FlightDesignator
}

/** One finished leg of an itinerary: the leg and the flight chosen for it */
export interface ItineraryLeg {
  readonly leg: FlightLeg
  readonly flight: FlightOption
}

/**
 * Where the picker stands: either the current leg's options are ready to
 * choose from, or every leg has been chosen.
 */
export type MultiCityStep = PickLeg | ItineraryComplete

export interface PickLeg {
  readonly _tag: "PickLeg"
  /** 0-based index of the leg being picked */
  readonly legIndex: number
  readonly legCount: number
  readonly leg: FlightLeg
  readonly options: readonly MultiCityLegOption[]
  readonly chosen: readonly ItineraryLeg[]
  /** Picker internals - callers pass the step back, never read this */
  readonly session: PickerSession
}

export interface ItineraryComplete {
  readonly _tag: "Complete"
  readonly itinerary: readonly ItineraryLeg[]
}

/** Internal wizard state threaded through the steps */
interface PickerSession {
  readonly rpc: RpcSession
  readonly legs: readonly FlightLeg[]
  readonly passengers: Passengers
  readonly selections: ReadonlyArray<FlightDesignator | undefined>
  readonly sessionSlot: readonly unknown[]
  readonly legIndex: number
}

const formatTime = (hm: unknown): string =>
  Array.isArray(hm) && typeof hm[0] === "number" ? formatClock12(hm[0], typeof hm[1] === "number" ? hm[1] : 0) : ""

const formatDuration = (minutes: unknown): string =>
  typeof minutes === "number" ? formatDurationHrMin(minutes) : "N/A"

/** A "provider entry" is one bookable flight: [[code, names, flights], [[null, price], token], ...] */
const isProviderEntry = (value: unknown): value is [[string, string[], unknown[]], [[null, number], string], ...unknown[]] =>
  Array.isArray(value) &&
  Array.isArray(value[0]) && typeof value[0][0] === "string" && Array.isArray(value[0][1]) && Array.isArray(value[0][2]) &&
  Array.isArray(value[1]) && Array.isArray(value[1][0]) && typeof value[1][1] === "string"

/** A "provider group" is the list of bookable flights (and null placeholders) shown for one leg */
const isProviderGroup = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => entry === null || isProviderEntry(entry))

/** Finds every provider group in the response whose flights match this leg's endpoints */
const findProviderGroupsForLeg = (node: unknown, from: string, to: string, into: unknown[][]): void => {
  if (!Array.isArray(node)) return

  if (isProviderGroup(node)) {
    const matchesLeg = node.some((entry) => {
      if (!isProviderEntry(entry)) return false
      const flight = entry[0][2]?.[0]
      return Array.isArray(flight) && flight[3] === from && flight[6] === to
    })
    if (matchesLeg) {
      into.push(node)
      return
    }
  }

  for (const child of node) findProviderGroupsForLeg(child, from, to, into)
}

const candidateFromProviderEntry = (entry: unknown): MultiCityLegOption | undefined => {
  if (!isProviderEntry(entry)) return undefined

  const [, names, flights] = entry[0]
  const flight = flights[0]
  if (!Array.isArray(flight)) return undefined

  const designatorTuple = flight[22]
  if (!Array.isArray(designatorTuple) || typeof designatorTuple[0] !== "string" || typeof designatorTuple[1] !== "string") return undefined
  const designator: FlightDesignator = { carrier: designatorTuple[0], number: designatorTuple[1] }

  const priceTuple = entry[1][0]
  const price = Array.isArray(priceTuple) && typeof priceTuple[1] === "number" ? priceTuple[1] : undefined
  const token = entry[1][1]

  return {
    flight: FlightOption.make({
      name: names[0] ?? designator.carrier,
      departure: formatTime(flight[8]),
      arrival: formatTime(flight[10]),
      duration: formatDuration(flight[11]),
      stops: 0, // Approximation: connecting itineraries aren't modeled in this path yet
      price: price !== undefined ? `$${price}` : "N/A",
      flight_number: formatDesignator(designator)
    }),
    token,
    designator
  }
}

const buildLegTuple = (leg: FlightLeg, selection: FlightDesignator | undefined): unknown[] => [
  [[[leg.from, 0]]], [[[leg.to, 0]]], null, 0, null, null, leg.date,
  null,
  selection ? [[leg.from, leg.date, leg.to, null, selection.carrier, selection.number]] : null,
  null, null, null, null, null, 3
]

const buildShoppingPayload = (session: PickerSession): unknown => [
  session.sessionSlot,
  [null, null, 3, null, [], 1,
    [session.passengers.adults, session.passengers.children, session.passengers.infants_in_seat, session.passengers.infants_on_lap],
    null, null, null, null, null, null,
    session.legs.map((leg, i) => buildLegTuple(leg, session.selections[i])),
    null, null, null, 1],
  0, 0, 0, 1
]

/**
 * Fetches the bookable options for the session's current leg, retrying
 * because Google's shopping endpoint occasionally answers a well-formed
 * request with a transient internal error.
 */
const fetchLegOptions = Effect.fn("MultiCity.fetchLegOptions")(function* (session: PickerSession) {
  const leg = session.legs[session.legIndex]

  const attemptFetch = Effect.gen(function* () {
    const blocks = yield* callFlightsRpc({
      endpoint: SHOPPING_ENDPOINT,
      session: session.rpc,
      payload: buildShoppingPayload(session),
    })

    const groups: unknown[][] = []
    for (const block of blocks) {
      findProviderGroupsForLeg(block, leg.from, leg.to, groups)
    }

    return groups
      .flatMap((group) => group.map(candidateFromProviderEntry))
      .filter((candidate): candidate is MultiCityLegOption => candidate !== undefined)
  })

  return yield* attemptFetch.pipe(
    Effect.repeat({ until: (candidates) => candidates.length > 0, times: 2 })
  )
})

/** Builds the step callers see for the session's current leg */
const stepForSession = Effect.fn("MultiCity.step")(function* (
  session: PickerSession,
  chosen: readonly ItineraryLeg[]
) {
  if (session.legIndex >= session.legs.length) {
    const complete: MultiCityStep = { _tag: "Complete", itinerary: chosen }
    return complete
  }

  const leg = session.legs[session.legIndex]
  const options = yield* fetchLegOptions(session)
  if (options.length === 0) {
    return yield* Effect.fail(
      ScraperErrors.parsingError(`No flights found for leg ${session.legIndex + 1} (${leg.from} -> ${leg.to})`)
    )
  }

  const step: MultiCityStep = {
    _tag: "PickLeg",
    legIndex: session.legIndex,
    legCount: session.legs.length,
    leg,
    options,
    chosen,
    session,
  }
  return step
})

/**
 * Fetches the multi-city search page, establishes the wizard session, and
 * returns the first step (leg 1's options).
 */
export const startMultiCityPicker = Effect.fn("MultiCity.start")(function* (params: MultiCityParams) {
  const legs: FlightLeg[] = [{ from: params.from, to: params.to, date: params.departDate }, ...params.additionalLegs]

  const searchUrl = yield* buildFlightUrl(
    legs.map((leg) => ({ date: leg.date, from_airport: leg.from, to_airport: leg.to })),
    "multi-city",
    params.seat,
    params.passengers,
    params.currency ?? ""
  )

  const html = yield* fetchSearchPage(searchUrl)

  const rpc = extractRpcSession(html, searchUrl)
  const genericToken = html.match(/(H[A-Za-z0-9_-]{30,60}AAAAAG[A-Za-z0-9_-]{5,20})/)?.[1]
  if (!rpc || !genericToken) {
    return yield* Effect.fail(ScraperErrors.parsingError("Could not find a shopping session token on the multi-city search page"))
  }

  const session: PickerSession = {
    rpc,
    legs,
    passengers: params.passengers,
    selections: legs.map(() => undefined),
    sessionSlot: [null, null, null, genericToken],
    legIndex: 0,
  }

  return yield* stepForSession(session, [])
})

/**
 * Records the chosen option for the step's leg and advances: either the
 * next leg's options, or the completed itinerary.
 */
export const chooseMultiCityOption = Effect.fn("MultiCity.choose")(function* (
  step: PickLeg,
  option: MultiCityLegOption
) {
  const session = step.session
  const next: PickerSession = {
    ...session,
    selections: session.selections.map((selection, i) => (i === session.legIndex ? option.designator : selection)),
    sessionSlot: [null, option.token],
    legIndex: session.legIndex + 1,
  }
  return yield* stepForSession(next, [...step.chosen, { leg: step.leg, flight: option.flight }])
})

/**
 * Scrapes a multi-city itinerary by walking the picker greedily - cheapest
 * flight at each step. For non-interactive callers (e.g. the CLI) that can't
 * pick a flight themselves.
 */
export const fetchMultiCityItinerary = Effect.fn("MultiCity.fetchItinerary")(function* (params: MultiCityParams) {
  let step = yield* startMultiCityPicker(params)

  while (step._tag === "PickLeg") {
    const current = step
    const cheapest = current.options.reduce((best, candidate) =>
      parsePrice(candidate.flight.price) < parsePrice(best.flight.price) ? candidate : best
    )
    step = yield* chooseMultiCityOption(current, cheapest)
  }

  return Result.make({ flights: step.itinerary.map((entry) => entry.flight) })
})
