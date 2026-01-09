/**
 * Protocol Buffer utilities for Google Flights API
 * Based on reverse engineering from fast-flights: https://github.com/AWeirdDev/flights
 */

import protobuf from "protobufjs"
import { Effect } from "effect"
import { ScraperError, TripType, SeatClass, Passengers, FlightSegment } from "../domain"

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
      // NOTE: Date must keep dashes (YYYY-MM-DD format) - Google Flights expects this format
      const data = flightData.map(fd => ({
        date: fd.date, // Keep as YYYY-MM-DD format (e.g., "2026-01-25")
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

/**
 * Encodes booking URL with specific flight segments
 * Based on reverse-engineering Google Flights booking URL format:
 * https://www.google.com/travel/flights/booking?tfs=...
 * 
 * Booking tfs structure (protobuf):
 * - Field 1: Unknown (varint, typically 28)
 * - Field 2: Trip type (varint, 2=one-way)
 * - Field 3: Main data (nested message with segments)
 * - Field 8: Passengers (varint)
 * - Field 9: Seat class (varint)
 * - Field 14: Unknown (varint, 1)
 * - Field 16: Price marker (nested, -1)
 * - Field 19: Trip type again (varint)
 * 
 * Segment structure (inside Field 3, Field 4):
 * - Field 1: Origin airport
 * - Field 2: Date (YYYY-MM-DD)
 * - Field 3: Destination airport
 * - Field 5: Airline IATA code
 * - Field 6: Flight number
 */
export const encodeBookingTfs = (
  segments: FlightSegment[],
  originAirport: string,
  destinationAirport: string,
  tripType: TripType,
  seat: SeatClass,
  passengers: Passengers
): Effect.Effect<string, ScraperError> =>
  Effect.try({
    try: () => {
      // Helper to write protobuf fields manually
      const writeVarint = (value: number): number[] => {
        const result: number[] = []
        while (value > 0x7f) {
          result.push((value & 0x7f) | 0x80)
          value >>>= 7
        }
        result.push(value)
        return result
      }

      const writeString = (field: number, str: string): number[] => {
        const bytes = Buffer.from(str, 'utf8')
        return [
          (field << 3) | 2, // wire type 2 (length-delimited)
          bytes.length,
          ...bytes
        ]
      }

      const writeVarintField = (field: number, value: number): number[] => {
        return [(field << 3) | 0, ...writeVarint(value)]
      }

      // Encode a single segment
      const encodeSegment = (seg: FlightSegment): number[] => {
        return [
          ...writeString(1, seg.origin),
          ...writeString(2, seg.date),
          ...writeString(3, seg.destination),
          ...writeString(5, seg.airline),
          ...writeString(6, seg.flight_number)
        ]
      }

      // Encode origin/destination markers (Fields 13 and 14 in main data)
      const encodeAirportMarker = (field: number, airport: string): number[] => {
        const inner = [
          ...writeVarintField(1, 1),
          ...writeString(2, airport)
        ]
        return [(field << 3) | 2, inner.length, ...inner]
      }

      // Map seat class to enum value
      const seatMap: Record<SeatClass, number> = {
        "economy": 1,
        "premium-economy": 2,
        "business": 3,
        "first": 4
      }

      // Map trip type to enum value
      const tripMap: Record<TripType, number> = {
        "round-trip": 1,
        "one-way": 2,
        "multi-city": 3
      }

      // Build the main data field (Field 3)
      const mainDataParts: number[] = []
      
      // Field 2: Overall date (first segment's date)
      if (segments.length > 0) {
        mainDataParts.push(...writeString(2, segments[0].date))
      }

      // Field 4: Each segment
      for (const seg of segments) {
        const segBytes = encodeSegment(seg)
        mainDataParts.push((4 << 3) | 2, segBytes.length, ...segBytes)
      }

      // Fields 13 and 14: Origin and destination markers
      mainDataParts.push(...encodeAirportMarker(13, originAirport))
      mainDataParts.push(...encodeAirportMarker(14, destinationAirport))

      // Build the complete message
      const message: number[] = []
      
      // Field 1: Unknown constant (28)
      message.push(...writeVarintField(1, 28))
      
      // Field 2: Trip type
      message.push(...writeVarintField(2, tripMap[tripType]))
      
      // Field 3: Main data
      message.push((3 << 3) | 2, ...writeVarint(mainDataParts.length), ...mainDataParts)
      
      // Field 8: Number of passengers (just count adults for simplicity)
      const totalPassengers = passengers.adults + passengers.children + 
                             passengers.infants_in_seat + passengers.infants_on_lap
      message.push(...writeVarintField(8, totalPassengers))
      
      // Field 9: Seat class
      message.push(...writeVarintField(9, seatMap[seat]))
      
      // Field 14: Unknown (1)
      message.push(...writeVarintField(14, 1))
      
      // Field 16: Price marker (nested with -1 value encoded as max int64)
      const priceMarker = [...writeVarintField(1, 0xffffffff), 0xff, 0xff, 0xff, 0xff, 0x0f]
      message.push((16 << 3) | 2, priceMarker.length, ...priceMarker)
      
      // Field 19: Trip type again
      message.push(...writeVarintField(19, tripMap[tripType]))

      // Convert to base64 URL-safe
      const buffer = Buffer.from(message)
      const base64 = buffer.toString("base64")
      return base64
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "")
    },
    catch: (error) =>
      new ScraperError({
        reason: "ParsingError",
        message: `Failed to encode booking URL: ${error}`
      })
  })

/**
 * Constructs the Google Flights booking URL for a specific flight
 */
export const buildBookingUrl = (
  segments: FlightSegment[],
  originAirport: string,
  destinationAirport: string,
  tripType: TripType,
  seat: SeatClass,
  passengers: Passengers,
  currency: string = "USD"
): Effect.Effect<string, ScraperError> =>
  Effect.gen(function* () {
    const tfs = yield* encodeBookingTfs(
      segments,
      originAirport,
      destinationAirport,
      tripType,
      seat,
      passengers
    )

    const params = new URLSearchParams({
      tfs,
      hl: "en",
      curr: currency,
      // tfu is optional for booking URLs - Google generates it
    })

    return `https://www.google.com/travel/flights/booking?${params.toString()}`
  })
