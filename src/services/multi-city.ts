/**
 * Scrapes multi-city itineraries.
 *
 * Unlike one-way/round-trip, Google Flights has no single request that
 * returns a full multi-city itinerary with a total price - the real UI is a
 * step-by-step wizard: you pick a flight for leg 1, which reveals leg 2's
 * options (via the same internal GetShoppingResults endpoint, now carrying
 * leg 1's chosen flight token), and so on.
 *
 * This module exposes that chain as composable steps (startMultiCitySession /
 * fetchCurrentLegOptions / chooseLegOption) so a caller can drive selection
 * itself - e.g. the TUI lets the user pick from each leg's real options,
 * exactly like the Google Flights UI does. fetchMultiCityItinerary is a
 * greedy (cheapest-per-leg) convenience built from the same steps, for
 * non-interactive callers like the CLI.
 */

import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import {
  AirportCode, DateString, FlightLeg, FlightOption, Passengers, Result, ScraperErrors, SeatClass
} from "../domain"
import { buildFlightUrl } from "../utils/protobuf"
import { parsePrice } from "./flight-parsing"
import { BROWSER_HEADERS, fetchSearchPage } from "./search-page"

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

export interface LegSelection {
  readonly airlineCode: string
  readonly flightNumber: string
}

/** One bookable flight option for a leg, along with what's needed to select it */
export interface MultiCityLegOption {
  readonly flight: FlightOption
  readonly token: string
  readonly designator: LegSelection
}

/** Immutable snapshot of an in-progress multi-city selection */
export interface MultiCitySession {
  readonly bl: string
  readonly fSid: string
  readonly searchUrl: string
  readonly legs: readonly FlightLeg[]
  readonly passengers: Passengers
  readonly selections: ReadonlyArray<LegSelection | undefined>
  readonly sessionSlot: readonly unknown[]
  /** Index of the leg whose options fetchCurrentLegOptions will return next */
  readonly legIndex: number
}

export const isMultiCitySessionComplete = (session: MultiCitySession): boolean =>
  session.legIndex >= session.legs.length

const formatTime = (hm: unknown): string => {
  if (!Array.isArray(hm) || typeof hm[0] !== "number") return ""
  const [h, m = 0] = hm
  const period = h >= 12 ? "PM" : "AM"
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`
}

const formatDuration = (minutes: unknown): string => {
  if (typeof minutes !== "number") return "N/A"
  const hrs = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`
}

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

  const priceTuple = entry[1][0]
  const price = Array.isArray(priceTuple) && typeof priceTuple[1] === "number" ? priceTuple[1] : undefined
  const token = entry[1][1]

  return {
    flight: FlightOption.make({
      name: names[0] ?? designatorTuple[0],
      departure: formatTime(flight[8]),
      arrival: formatTime(flight[10]),
      duration: formatDuration(flight[11]),
      stops: 0, // Approximation: connecting itineraries aren't modeled in this path yet
      price: price !== undefined ? `$${price}` : "N/A",
      flight_number: `${designatorTuple[0]}${designatorTuple[1]}`
    }),
    token,
    designator: { airlineCode: designatorTuple[0], flightNumber: designatorTuple[1] }
  }
}

/** Parses every `)]}'`-prefixed wrb.fr JSON payload out of a raw RPC response body */
const parseResponseBlocks = (responseText: string): unknown[] => {
  const blocks: unknown[] = []
  for (const line of responseText.split("\n")) {
    if (!line.startsWith('[["wrb.fr"')) continue
    try {
      const outer = JSON.parse(line)
      const payload = outer[0]?.[2]
      if (typeof payload === "string") blocks.push(JSON.parse(payload))
    } catch {
      continue
    }
  }
  return blocks
}

const buildLegTuple = (leg: FlightLeg, selection: LegSelection | undefined): unknown[] => [
  [[[leg.from, 0]]], [[[leg.to, 0]]], null, 0, null, null, leg.date,
  null,
  selection ? [[leg.from, leg.date, leg.to, null, selection.airlineCode, selection.flightNumber]] : null,
  null, null, null, null, null, 3
]

const buildRequestBody = (session: MultiCitySession): string => {
  const innerArray = [
    session.sessionSlot,
    [null, null, 3, null, [], 1,
      [session.passengers.adults, session.passengers.children, session.passengers.infants_in_seat, session.passengers.infants_on_lap],
      null, null, null, null, null, null,
      session.legs.map((leg, i) => buildLegTuple(leg, session.selections[i])),
      null, null, null, 1],
    0, 0, 0, 1
  ]
  const fReq = JSON.stringify([null, JSON.stringify(innerArray)])
  return `f.req=${encodeURIComponent(fReq)}&`
}

/**
 * Fetches the multi-city search page and extracts the session info
 * (f.sid, bl, and a booking token) needed to drive per-leg selection.
 */
export const startMultiCitySession = Effect.fn("MultiCity.startSession")(function* (params: MultiCityParams) {
  const legs: FlightLeg[] = [{ from: params.from, to: params.to, date: params.departDate }, ...params.additionalLegs]

  const searchUrl = yield* buildFlightUrl(
    legs.map((leg) => ({ date: leg.date, from_airport: leg.from, to_airport: leg.to })),
    "multi-city",
    params.seat,
    params.passengers,
    params.currency ?? ""
  )

  const html = yield* fetchSearchPage(searchUrl)

  const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1]
  const fSid = html.match(/"FdrFJe":"?(-?\d+)"?/)?.[1]
  const genericToken = html.match(/(H[A-Za-z0-9_-]{30,60}AAAAAG[A-Za-z0-9_-]{5,20})/)?.[1]
  if (!bl || !fSid || !genericToken) {
    return yield* Effect.fail(ScraperErrors.parsingError("Could not find a shopping session token on the multi-city search page"))
  }

  const session: MultiCitySession = {
    bl,
    fSid,
    searchUrl,
    legs,
    passengers: params.passengers,
    selections: legs.map(() => undefined),
    sessionSlot: [null, null, null, genericToken],
    legIndex: 0
  }
  return session
})

/**
 * Fetches the bookable flight options for the session's current leg
 * (session.legIndex). Returns an empty array once the session is complete.
 */
export const fetchCurrentLegOptions = Effect.fn("MultiCity.fetchLegOptions")(function* (session: MultiCitySession) {
  if (isMultiCitySessionComplete(session)) return []
  const leg = session.legs[session.legIndex]
  const client = yield* HttpClient.HttpClient

  const attemptFetch = Effect.gen(function* () {
    const body = buildRequestBody(session)
    const reqid = Math.floor(Math.random() * 900_000) + 100_000
    const rpcUrl = `${SHOPPING_ENDPOINT}?f.sid=${session.fSid}&bl=${session.bl}&hl=en&soc-app=162&soc-platform=1&soc-device=1&_reqid=${reqid}&rt=c`

    const request = HttpClientRequest.post(rpcUrl).pipe(
      HttpClientRequest.setHeaders({
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
        "referer": session.searchUrl,
        "user-agent": BROWSER_HEADERS["User-Agent"]
      }),
      HttpClientRequest.bodyText(body, "application/x-www-form-urlencoded;charset=UTF-8")
    )

    const responseText = yield* client.execute(request).pipe(
      Effect.flatMap((response) => response.text),
      Effect.mapError((error) => ScraperErrors.navigationFailed(rpcUrl, String(error)))
    )

    const groups: unknown[][] = []
    for (const block of parseResponseBlocks(responseText)) {
      findProviderGroupsForLeg(block, leg.from, leg.to, groups)
    }

    return groups
      .flatMap((group) => group.map(candidateFromProviderEntry))
      .filter((candidate): candidate is MultiCityLegOption => candidate !== undefined)
  })

  // Google's shopping endpoint occasionally answers a well-formed request
  // with a transient internal error; a same-request retry reliably clears it.
  return yield* attemptFetch.pipe(
    Effect.repeat({ until: (candidates) => candidates.length > 0, times: 2 })
  )
})

/** Advances the session to the next leg, recording the chosen flight */
export const chooseLegOption = (session: MultiCitySession, choice: MultiCityLegOption): MultiCitySession => ({
  ...session,
  selections: session.selections.map((selection, i) => i === session.legIndex ? choice.designator : selection),
  sessionSlot: [null, choice.token],
  legIndex: session.legIndex + 1
})

/**
 * Scrapes a multi-city itinerary by chaining one GetShoppingResults request
 * per leg, greedily picking the cheapest flight at each step. For
 * non-interactive callers (e.g. the CLI) that can't pick a flight themselves.
 */
export const fetchMultiCityItinerary = Effect.fn("MultiCity.fetchItinerary")(function* (params: MultiCityParams) {
  let session = yield* startMultiCitySession(params)
  const chosenFlights: FlightOption[] = []

  while (!isMultiCitySessionComplete(session)) {
    const candidates = yield* fetchCurrentLegOptions(session)
    if (candidates.length === 0) {
      const leg = session.legs[session.legIndex]
      return yield* Effect.fail(ScraperErrors.parsingError(`No flights found for leg ${session.legIndex + 1} (${leg.from} -> ${leg.to})`))
    }

    const cheapest = candidates.reduce((best, candidate) =>
      parsePrice(candidate.flight.price) < parsePrice(best.flight.price) ? candidate : best
    )
    chosenFlights.push(cheapest.flight)
    session = chooseLegOption(session, cheapest)
  }

  return Result.make({ flights: chosenFlights })
})
