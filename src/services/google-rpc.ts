/**
 * Transport for Google Flights' private frontend RPC surface
 * (FlightsFrontendService endpoints like GetShoppingResults and
 * GetBookingResults). Owns everything every caller would otherwise
 * duplicate: the session values scraped from a search page, the f.req
 * double-JSON request envelope, the URL recipe and headers, and the
 * wrb.fr response envelope.
 *
 * Callers supply their endpoint and inner payload array and interpret the
 * decoded payload blocks - Google's per-endpoint array layouts stay in the
 * calling module.
 */

import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ScraperErrors } from "../domain"

export const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/**
 * The values Google's web app sends with every frontend RPC, scraped as
 * plain text from any search-results page.
 */
export interface RpcSession {
  readonly bl: string
  readonly fSid: string
  /** The search page this session came from; sent as the RPC referer */
  readonly referer: string
}

/** Scrapes the RPC session values embedded in a search-results page */
export const extractRpcSession = (html: string, referer: string): RpcSession | undefined => {
  const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1]
  const fSid = html.match(/"FdrFJe":"?(-?\d+)"?/)?.[1]
  return bl && fSid ? { bl, fSid, referer } : undefined
}

/** Encodes an inner payload array into Google's f.req form body */
export const encodeFReq = (payload: unknown): string => `f.req=${encodeURIComponent(JSON.stringify([null, JSON.stringify(payload)]))}&`

/**
 * Parses every wrb.fr JSON payload out of a raw RPC response body (a
 * `)]}'`-prefixed stream of newline-delimited JSON arrays).
 */
export const parseRpcBlocks = (responseText: string): unknown[] => {
  const blocks: unknown[] = []
  for (const line of responseText.split("\n")) {
    if (!line.startsWith('[["wrb.fr"')) continue
    try {
      const outer = JSON.parse(line)
      const payload = (outer as unknown[][])[0]?.[2]
      if (typeof payload === "string") blocks.push(JSON.parse(payload))
    } catch {
      continue
    }
  }
  return blocks
}

/**
 * Calls a FlightsFrontendService endpoint and returns the decoded wrb.fr
 * payload blocks.
 */
export const callFlightsRpc = Effect.fn("GoogleFlightsRpc.call")(function* (options: { readonly endpoint: string; readonly session: RpcSession; readonly payload: unknown }) {
  const client = yield* HttpClient.HttpClient
  const reqid = Math.floor(Math.random() * 900_000) + 100_000
  const url = `${options.endpoint}?f.sid=${options.session.fSid}&bl=${options.session.bl}&hl=en&soc-app=162&soc-platform=1&soc-device=1&_reqid=${reqid}&rt=c`

  const request = HttpClientRequest.post(url).pipe(
    HttpClientRequest.setHeaders({
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-same-domain": "1",
      referer: options.session.referer,
      "user-agent": USER_AGENT,
    }),
    HttpClientRequest.bodyText(encodeFReq(options.payload), "application/x-www-form-urlencoded;charset=UTF-8"),
  )

  const responseText = yield* client.execute(request).pipe(
    Effect.flatMap((response) => response.text),
    Effect.mapError((error) => ScraperErrors.navigationFailed(url, String(error))),
  )

  return parseRpcBlocks(responseText)
})
