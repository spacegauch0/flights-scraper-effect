import { Context, Data, Layer } from "effect"
import type { TripType, SeatClass, Passengers, FlightOption } from "../domain"

export class TuiState extends Data.TaggedClass("TuiState")<{
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
    readonly setOrigin: (origin: string) => TuiState
    readonly setDestination: (destination: string) => TuiState
    readonly setDepartDate: (departDate: string) => TuiState
    readonly setReturnDate: (returnDate: string) => TuiState
    readonly setTripType: (tripType: TripType) => TuiState
    readonly setSeatClass: (seatClass: SeatClass) => TuiState
    readonly setPassengers: (passengers: Passengers) => TuiState
    readonly setMaxStops: (maxStops: number) => TuiState
    readonly setLimit: (limit: number) => TuiState
    readonly setIsSearching: (isSearching: boolean) => TuiState
    readonly setResults: (results: FlightOption[]) => TuiState
    readonly setPriceLevel: (priceLevel?: "low" | "typical" | "high") => TuiState
    readonly setErrorMessage: (errorMessage?: string) => TuiState
    readonly setStatusMessage: (statusMessage: string) => TuiState
  }
>() {
  static readonly Live = Layer.sync(TuiStateService, () => {
    let state = new TuiState({
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
      setOrigin: (origin) => (state = state.copy({ origin })),
      setDestination: (destination) => (state = state.copy({ destination })),
      setDepartDate: (departDate) => (state = state.copy({ departDate })),
      setReturnDate: (returnDate) => (state = state.copy({ returnDate })),
      setTripType: (tripType) => (state = state.copy({ tripType })),
      setSeatClass: (seatClass) => (state = state.copy({ seatClass })),
      setPassengers: (passengers) => (state = state.copy({ passengers })),
      setMaxStops: (maxStops) => (state = state.copy({ maxStops })),
      setLimit: (limit) => (state = state.copy({ limit })),
      setIsSearching: (isSearching) => (state = state.copy({ isSearching })),
      setResults: (results) => (state = state.copy({ results })),
      setPriceLevel: (priceLevel) => (state = state.copy({ priceLevel })),
      setErrorMessage: (errorMessage) => (state = state.copy({ errorMessage })),
      setStatusMessage: (statusMessage) => (state = state.copy({ statusMessage })),
    })
  })
}
