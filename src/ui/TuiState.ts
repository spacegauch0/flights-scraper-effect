import { Context, Layer } from "effect"
import type { TripType, SeatClass, Passengers, FlightOption } from "../domain"

/** Mutable TUI state interface */
export interface TuiState {
  origin: string
  destination: string
  departDate: string
  returnDate: string
  tripType: TripType
  seatClass: SeatClass
  passengers: Passengers
  maxStops: number
  limit: number
  isSearching: boolean
  results: FlightOption[]
  priceLevel?: "low" | "typical" | "high"
  errorMessage?: string
  statusMessage: string
}

/** Creates default TUI state with dynamic dates */
const createDefaultState = (): TuiState => {
  const today = new Date()
  const defaultDepart = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)
  const defaultReturn = new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000)
  const formatDate = (d: Date) => d.toISOString().split("T")[0]
  
  return {
    origin: "JFK",
    destination: "LHR",
    departDate: formatDate(defaultDepart),
    returnDate: formatDate(defaultReturn),
    tripType: "one-way",
    seatClass: "economy",
    passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
    maxStops: 2,
    limit: 10,
    isSearching: false,
    results: [],
    statusMessage: "Enter: search | Ctrl+R: results | Ctrl+C: exit",
  }
}

export class TuiStateService extends Context.Tag("TuiStateService")<
  TuiStateService,
  {
    readonly state: TuiState
  }
>() {
  static readonly Live = Layer.sync(TuiStateService, () => ({
    state: createDefaultState()
  }))
}
