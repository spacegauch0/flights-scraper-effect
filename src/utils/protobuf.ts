/**
 * Protocol Buffer utilities for Google Flights API
 * Based on reverse engineering from fast-flights: https://github.com/AWeirdDev/flights
 */

import protobuf from "protobufjs"
import { Effect } from "effect"
import { ScraperError, TripType, SeatClass, Passengers } from "../domain"

export interface FlightData {
  date: string
  from_airport: string
  to_airport: string
  max_stops?: number
  airlines?: string[]
}

/**
 * Encodes flight search parameters into Google Flights' tfs parameter
 * The tfs parameter is a Base64-encoded Protocol Buffer matching Python implementation
 */
export const encodeFlightSearch = (
  flightData: FlightData[],
  tripType: TripType,
  seat: SeatClass,
  passengers: Passengers
): Effect.Effect<string, ScraperError> =>
  Effect.try({
    try: () => {
      // Create protobuf schema matching flights.proto from Python implementation
      const root = protobuf.Root.fromJSON({
        nested: {
          Info: {
            fields: {
              data: { rule: "repeated", type: "FlightData", id: 3 },
              seat: { type: "Seat", id: 9 },
              passengers: { rule: "repeated", type: "Passenger", id: 8 },
              trip: { type: "Trip", id: 19 }
            }
          },
          FlightData: {
            fields: {
              date: { type: "string", id: 2 },
              from_flight: { type: "Airport", id: 13 },
              to_flight: { type: "Airport", id: 14 },
              max_stops: { type: "int32", id: 5 },
              airlines: { rule: "repeated", type: "string", id: 6 }
            }
          },
          Airport: {
            fields: {
              airport: { type: "string", id: 2 }
            }
          },
          Seat: {
            values: {
              UNKNOWN_SEAT: 0,
              ECONOMY: 1,
              PREMIUM_ECONOMY: 2,
              BUSINESS: 3,
              FIRST: 4
            }
          },
          Trip: {
            values: {
              UNKNOWN_TRIP: 0,
              ROUND_TRIP: 1,
              ONE_WAY: 2,
              MULTI_CITY: 3
            }
          },
          Passenger: {
            values: {
              UNKNOWN_PASSENGER: 0,
              ADULT: 1,
              CHILD: 2,
              INFANT_IN_SEAT: 3,
              INFANT_ON_LAP: 4
            }
          }
        }
      })

      const Info = root.lookupType("Info")

      // Map seat class to enum
      const seatMap: Record<SeatClass, number> = {
        "economy": 1,
        "premium-economy": 2,
        "business": 3,
        "first": 4
      }

      // Map trip type to enum
      const tripMap: Record<TripType, number> = {
        "round-trip": 1,
        "one-way": 2,
        "multi-city": 3
      }

      // Build passenger array
      const passengerArray: number[] = []
      for (let i = 0; i < passengers.adults; i++) passengerArray.push(1) // ADULT
      for (let i = 0; i < passengers.children; i++) passengerArray.push(2) // CHILD
      for (let i = 0; i < passengers.infants_in_seat; i++) passengerArray.push(3) // INFANT_IN_SEAT
      for (let i = 0; i < passengers.infants_on_lap; i++) passengerArray.push(4) // INFANT_ON_LAP

      // Build flight data
      const data = flightData.map(fd => ({
        date: fd.date.replace(/-/g, ""), // Remove dashes: "2025-12-25" -> "20251225"
        from_flight: { airport: fd.from_airport },
        to_flight: { airport: fd.to_airport },
        max_stops: fd.max_stops,
        airlines: fd.airlines || []
      }))

      // Create the message
      const message = Info.create({
        data,
        seat: seatMap[seat],
        passengers: passengerArray,
        trip: tripMap[tripType]
      })

      // Encode to buffer
      const buffer = Info.encode(message).finish()

      // Convert to base64
      const base64 = Buffer.from(buffer).toString("base64")

      // URL-safe base64
      const urlSafe = base64
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "")

      return urlSafe
    },
    catch: (error) =>
      new ScraperError({
        reason: "ParsingError",
        message: `Failed to encode flight search: ${error}`
      })
  })

/**
 * Constructs the Google Flights search URL with encoded tfs parameter
 */
export const buildFlightUrl = (
  flightData: FlightData[],
  tripType: TripType,
  seat: SeatClass,
  passengers: Passengers,
  currency: string = ""
): Effect.Effect<string, ScraperError> =>
  Effect.gen(function* () {
    const tfs = yield* encodeFlightSearch(flightData, tripType, seat, passengers)
    const params = new URLSearchParams({
      tfs,
      hl: "en",
      tfu: "EgQIABABIgA"
    })
    
    if (currency) {
      params.set("curr", currency)
    }
    
    return `https://www.google.com/travel/flights?${params.toString()}`
  })

