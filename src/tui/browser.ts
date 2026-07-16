/**
 * Opens Google Flights URLs in the system browser.
 */

import { Effect } from "effect"
import { execFile } from "child_process"
import { buildFlightUrl } from "../utils"
import type { TripType, SeatClass, Passengers, AirportCode, DateString } from "../domain"

/**
 * Opens a URL in the default browser. Uses execFile (not exec) so the URL is
 * passed as an argument, never interpolated into a shell string.
 */
export function openInBrowser(url: string): void {
  const platform = process.platform
  if (platform === "darwin") {
    execFile("open", [url])
  } else if (platform === "win32") {
    // "start" is a cmd built-in; the empty string is the window title slot
    execFile("cmd", ["/c", "start", "", url])
  } else {
    execFile("xdg-open", [url])
  }
}

/** Builds Google Flights search URL using protobuf encoding (same as scraper) */
export async function buildGoogleFlightsUrl(
  origin: AirportCode,
  destination: AirportCode,
  departDate: DateString,
  tripType: TripType,
  returnDate?: DateString,
  seatClass: SeatClass = "economy",
  passengers: Passengers = { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
  currency: string = "USD",
): Promise<string> {
  const fallbackUrl = () => {
    let searchQuery = `Flights from ${origin} to ${destination} on ${departDate}`
    if (tripType === "round-trip" && returnDate) {
      searchQuery += ` return ${returnDate}`
    }
    return `https://www.google.com/travel/flights?q=${encodeURIComponent(searchQuery)}`
  }

  // Build flight data for protobuf encoding
  const flightData = [
    {
      date: departDate,
      from_airport: origin,
      to_airport: destination,
    },
  ]

  if (tripType === "round-trip" && returnDate) {
    flightData.push({
      date: returnDate,
      from_airport: destination,
      to_airport: origin,
    })
  }

  // Encode using protobuf (same as scraper), falling back to a search query URL
  return Effect.runPromise(buildFlightUrl(flightData, tripType, seatClass, passengers, currency).pipe(Effect.catch(() => Effect.succeed(fallbackUrl()))))
}
