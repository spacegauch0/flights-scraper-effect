/**
 * Shared fetch of a Google Flights search-results page.
 * Both scraper adapters (and the booking/multi-city session bootstraps)
 * request the same page with the same browser-like headers.
 */

import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Result, ScraperError, ScraperErrors } from "../domain"
import { parseHtmlFallback } from "./flight-parsing"
import { USER_AGENT } from "./google-rpc"

/** Browser-like headers Google expects on a search-page request */
export const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Cache-Control": "max-age=0",
}

/**
 * Fetches a Google Flights page as HTML, mapping transport and status
 * failures to a typed ScraperError.
 */
export const fetchSearchPage = Effect.fn("GoogleFlights.fetchSearchPage")(function* (url: string) {
  const client = yield* HttpClient.HttpClient

  const response = yield* client.get(url, { headers: BROWSER_HEADERS }).pipe(Effect.mapError((error) => ScraperErrors.navigationFailed(url, String(error))))

  return yield* response.text.pipe(Effect.mapError((error) => ScraperErrors.navigationFailed(url, `Failed to read response body: ${String(error)}`)))
})

/**
 * Extracts flight data from Google Flights HTML
 */
export const extractFlights = (html: string): Effect.Effect<Result, ScraperError> =>
  Effect.try({
    try: () => parseHtmlFallback(html),
    catch: (e) => ScraperErrors.parsingError(String(e)),
  })
