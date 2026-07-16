/**
 * Looks up the "Book with X" options Google Flights shows after selecting a
 * flight (the panel with per-provider prices and a "Continue" button), using
 * the same internal endpoint the web UI calls - no browser required.
 *
 * The session id (f.sid) and app version (bl) that endpoint needs are plain
 * text in the search-results page, and any token found on that page works
 * for any flight on it: the flight itself is selected by passing its
 * marketing-carrier designator (e.g. "BA178") in the request body. See
 * FlightOption.flight_number, decoded in flight-parsing.ts.
 */

import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { BookingOption, Passengers, ScraperErrors, SeatClass } from "../domain"
import { buildFlightUrl } from "../utils/protobuf"
import { BROWSER_HEADERS, fetchSearchPage } from "./search-page"

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

/** Splits a designator like "BA178" into carrier code and flight number */
const splitDesignator = (designator: string): { airlineCode: string; flightNumber: string } => ({
  airlineCode: designator.slice(0, 2),
  flightNumber: designator.slice(2)
})

const extractSessionInfo = (html: string): { bl: string; fSid: string } | undefined => {
  const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1]
  const fSid = html.match(/"FdrFJe":"?(-?\d+)"?/)?.[1]
  return bl && fSid ? { bl, fSid } : undefined
}

/** Any flight's booking token works as the session ticket for this request */
const extractAnyToken = (html: string): string | undefined => {
  const match = html.match(/\[\[null,\d+\],"(Cj[A-Za-z0-9_+/=-]+)"\]/)
  return match?.[1].replace(/\\u003d/g, "=")
}

const buildRequestBody = (
  token: string,
  from: string,
  to: string,
  date: string,
  airlineCode: string,
  flightNumber: string,
  passengers: Passengers
): string => {
  const innerArray = [
    [null, token],
    [null, null, 2, null, [], 1,
      [passengers.adults, passengers.children, passengers.infants_in_seat, passengers.infants_on_lap],
      null, null, null, null, null, null,
      [[[[[from, 0]]], [[[to, 0]]], null, 0, null, null, date, null,
        [[from, date, to, null, airlineCode, flightNumber]],
        null, null, null, null, null, 3]],
      null, null, null, 1],
    null, 0
  ]
  const fReq = JSON.stringify([null, JSON.stringify(innerArray)])
  return `f.req=${encodeURIComponent(fReq)}&`
}

/** Parses the `)]}'`-prefixed, newline-delimited RPC response into booking options */
const parseBookingOptionsResponse = (responseText: string): BookingOption[] => {
  const options: BookingOption[] = []

  for (const line of responseText.split("\n")) {
    if (!line.startsWith('[["wrb.fr"')) continue

    try {
      const outer = JSON.parse(line)
      const payload = outer[0]?.[2]
      if (typeof payload !== "string") continue

      const inner = JSON.parse(payload)
      const candidates = inner?.[1]?.[0]
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
        const price = Array.isArray(priceEntry) && typeof priceEntry[1] === "number"
          ? `${priceEntry[0]} ${priceEntry[1]}`
          : undefined

        options.push(BookingOption.make({
          providerCode,
          provider: providerName,
          price,
          url: `${clickBase}?u=${encodeURIComponent(uParam)}`
        }))
      }
    } catch {
      continue
    }
  }

  return options
}

/**
 * Fetches booking options for one flight. Re-fetches the search-results page
 * for `from`/`to`/`date` to obtain a fresh session token, then calls the
 * same internal endpoint the "Select flight" panel uses.
 */
export const fetchBookingOptions = Effect.fn("BookingOptions.fetch")(function* (params: BookingOptionsParams) {
  const client = yield* HttpClient.HttpClient
  const seatClass: SeatClass = params.seat || "economy"
  const passengers: Passengers = params.passengers || { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 }

  const searchUrl = yield* buildFlightUrl(
    [{ date: params.date, from_airport: params.from, to_airport: params.to }],
    "one-way",
    seatClass,
    passengers,
    params.currency ?? ""
  )

  const html = yield* fetchSearchPage(searchUrl)

  const session = extractSessionInfo(html)
  const token = extractAnyToken(html)
  if (!session || !token) {
    return yield* Effect.fail(ScraperErrors.parsingError("Could not find a booking session token on the search-results page"))
  }

  const { airlineCode, flightNumber } = splitDesignator(params.flightNumber)
  const body = buildRequestBody(token, params.from, params.to, params.date, airlineCode, flightNumber, passengers)
  const reqid = Math.floor(Math.random() * 900_000) + 100_000
  const rpcUrl = `${BOOKING_ENDPOINT}?f.sid=${session.fSid}&bl=${session.bl}&hl=en&soc-app=162&soc-platform=1&soc-device=1&_reqid=${reqid}&rt=c`

  const request = HttpClientRequest.post(rpcUrl).pipe(
    HttpClientRequest.setHeaders({
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-same-domain": "1",
      "referer": searchUrl,
      "user-agent": BROWSER_HEADERS["User-Agent"]
    }),
    HttpClientRequest.bodyText(body, "application/x-www-form-urlencoded;charset=UTF-8")
  )

  const responseText = yield* client.execute(request).pipe(
    Effect.flatMap((response) => response.text),
    Effect.mapError((error) => ScraperErrors.navigationFailed(rpcUrl, String(error)))
  )

  return parseBookingOptionsResponse(responseText)
})
