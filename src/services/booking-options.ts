/**
 * Looks up the "Book with X" options Google Flights shows after selecting a
 * flight (the panel with per-provider prices and a "Continue" button), using
 * the same internal endpoint the web UI calls - no browser required.
 *
 * The RPC session lives in plain text on the search-results page, and any
 * booking token found there works for any flight on it: the flight itself is
 * selected by passing its designator (e.g. "BA178") in the request payload.
 * See FlightOption.flight_number, decoded in flight-parsing.ts.
 *
 * Transport concerns (session values, request envelope, response envelope)
 * live in google-rpc.ts; this module owns only the GetBookingResults payload
 * and response layout.
 */

import { Effect } from "effect"
import { BookingOption, Passengers, ScraperErrors, SeatClass, parseDesignator, parsePrice, type FlightDesignator } from "../domain"
import { buildFlightUrl } from "../utils/protobuf"
import { callFlightsRpc, extractRpcSession } from "./google-rpc"
import { fetchSearchPage } from "./search-page"

const BOOKING_ENDPOINT = "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetBookingResults"

export interface BookingOptionsParams {
  readonly from: string
  readonly to: string
  readonly date: string
  readonly flightNumber: string
  readonly seat?: SeatClass
  readonly passengers?: Passengers
  readonly currency?: string
}

/**
 * The lowest-priced booking option. Options without a parseable price only
 * win when nothing is priced.
 */
export const cheapestBookingOption = (options: readonly BookingOption[]): BookingOption | undefined =>
  options.reduce<BookingOption | undefined>((best, option) => {
    if (!best) return option
    const priceOf = (candidate: BookingOption) => {
      const parsed = candidate.price ? parsePrice(candidate.price) : 0
      return parsed > 0 ? parsed : Number.POSITIVE_INFINITY
    }
    return priceOf(option) < priceOf(best) ? option : best
  }, undefined)

/** Any flight's booking token works as the session ticket for this request */
const extractAnyToken = (html: string): string | undefined => {
  const match = html.match(/\[\[null,\d+\],"(Cj[A-Za-z0-9_+/=-]+)"\]/)
  return match?.[1].replace(/\\u003d/g, "=")
}

const buildBookingPayload = (token: string, from: string, to: string, date: string, designator: FlightDesignator, passengers: Passengers): unknown => [
  [null, token],
  [
    null,
    null,
    2,
    null,
    [],
    1,
    [passengers.adults, passengers.children, passengers.infants_in_seat, passengers.infants_on_lap],
    null,
    null,
    null,
    null,
    null,
    null,
    [[[[[from, 0]]], [[[to, 0]]], null, 0, null, null, date, null, [[from, date, to, null, designator.carrier, designator.number]], null, null, null, null, null, 3]],
    null,
    null,
    null,
    1,
  ],
  null,
  0,
]

/** Extracts booking options from the decoded GetBookingResults payload blocks */
export const parseBookingOptions = (blocks: readonly unknown[]): BookingOption[] => {
  const options: BookingOption[] = []

  for (const block of blocks) {
    const candidates = (block as unknown[][])?.[1]?.[0]
    if (!Array.isArray(candidates)) continue

    for (const opt of candidates) {
      if (!Array.isArray(opt)) continue

      const providerInfo = opt[1]?.[0]
      const clickInfo = opt[5]
      if (!Array.isArray(providerInfo) || !Array.isArray(clickInfo)) continue

      const [providerCode, providerName] = providerInfo
      const clickBase = clickInfo[2]?.[0]
      const clickParams = clickInfo[2]?.[1]
      if (typeof providerCode !== "string" || typeof providerName !== "string") continue
      if (typeof clickBase !== "string" || !Array.isArray(clickParams)) continue

      const uParam = clickParams.find((p: unknown) => Array.isArray(p) && p[0] === "u")?.[1]
      if (typeof uParam !== "string") continue

      const priceEntry = Array.isArray(opt[8]) ? opt[8][0] : undefined
      const price = Array.isArray(priceEntry) && typeof priceEntry[1] === "number" ? `${priceEntry[0]} ${priceEntry[1]}` : undefined

      options.push(
        BookingOption.make({
          providerCode,
          provider: providerName,
          price,
          url: `${clickBase}?u=${encodeURIComponent(uParam)}`,
        }),
      )
    }
  }

  return options
}

/**
 * Fetches booking options for one flight. Re-fetches the search-results page
 * for `from`/`to`/`date` to obtain a fresh session and token, then calls the
 * same internal endpoint the "Select flight" panel uses.
 */
export const fetchBookingOptions = Effect.fn("BookingOptions.fetch")(function* (params: BookingOptionsParams) {
  const seatClass: SeatClass = params.seat || "economy"
  const passengers: Passengers = params.passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }

  const designator = parseDesignator(params.flightNumber)
  if (!designator) {
    return yield* Effect.fail(ScraperErrors.invalidInput("flightNumber", `Not a flight designator: ${params.flightNumber}`))
  }

  const searchUrl = yield* buildFlightUrl([{ date: params.date, from_airport: params.from, to_airport: params.to }], "one-way", seatClass, passengers, params.currency ?? "")

  const html = yield* fetchSearchPage(searchUrl)

  const session = extractRpcSession(html, searchUrl)
  const token = extractAnyToken(html)
  if (!session || !token) {
    return yield* Effect.fail(ScraperErrors.parsingError("Could not find a booking session token on the search-results page"))
  }

  const blocks = yield* callFlightsRpc({
    endpoint: BOOKING_ENDPOINT,
    session,
    payload: buildBookingPayload(token, params.from, params.to, params.date, designator, passengers),
  })

  return parseBookingOptions(blocks)
})
