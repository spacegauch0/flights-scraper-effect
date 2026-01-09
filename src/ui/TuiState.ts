import { Context, Data, Layer } from "effect"
import type { TripType, SeatClass, Passengers, FlightOption } from "./domain"

export class TuiState extends Data.Tagged("TuiState")<{
  readonly origin: string
  readonly destination: string
  readonly departDate: string
  readonly returnDate: string
  readonly tripType: TripType
  readonly seatClass: SeatClass
  readonly passengers: Passengers
  readonly maxStops: number
  readonly limit: number
  readonly isSearching: boolean
  readonly results: FlightOption[]
  readonly priceLevel?: "low" | "typical" | "high"
  readonly errorMessage?: string
  readonly statusMessage: string
}> {}

export class TuiStateService extends Context.Tag("TuiStateService")<
  TuiStateService,
  {
    readonly state: TuiState
    readonly setOrigin: (origin: string) => void
    readonly setDestination: (destination: string) => void
    readonly setDepartDate: (departDate: string) => void
    readonly setReturnDate: (returnDate: string) => void
    readonly setTripType: (tripType: TripType) => void
    readonly setSeatClass: (seatClass: SeatClass) => void
    readonly setPassengers: (passengers: Passengers) => void
    readonly setMaxStops: (maxStops: number) => void
    readonly setLimit: (limit: number) => void
    readonly setIsSearching: (isSearching: boolean) => void
    readonly setResults: (results: FlightOption[]) => void
    readonly setPriceLevel: (priceLevel?: "low" | "typical" | "high") => void
    readonly setErrorMessage: (errorMessage?: string) => void
    readonly setStatusMessage: (statusMessage: string) => void
  }
>() {
  static readonly Live = Layer.sync(TuiStateService, () => {
    const state = new TuiState({
      origin: "JFK",
      destination: "LHR",
      departDate: "2025-12-25",
      returnDate: "2025-12-30",
      tripType: "one-way",
      seatClass: "economy",
      passengers: { adults: 1 },
      maxStops: 2,
      limit: 10,
      isSearching: false,
      results: [],
      statusMessage: "Enter: search | Ctrl+R: results | Ctrl+C: exit",
    })

    return TuiStateService.of({
      state,
      setOrigin: (origin) => (state.origin = origin),
      setDestination: (destination) => (state.destination = destination),
      setDepartDate: (departDate) => (state.departDate = departDate),
      setReturnDate: (returnDate) => (state.returnDate = returnDate),
      setTripType: (tripType) => (state.tripType = tripType),
      setSeatClass: (seatClass) => (state.seatClass = seatClass),
      setPassengers: (passengers) => (state.passengers = passengers),
      setMaxStops: (maxStops) => (state.maxStops = maxStops),
      setLimit: (limit) => (state.limit = limit),
      setIsSearching: (isSearching) => (state.isSearching = isSearching),
      setResults: (results) => (state.results = results),
      setPriceLevel: (priceLevel) => (state.priceLevel = priceLevel),
      setErrorMessage: (errorMessage) => (state.errorMessage = errorMessage),
      setStatusMessage: (statusMessage) => (state.statusMessage = statusMessage),
    })
  })
}
