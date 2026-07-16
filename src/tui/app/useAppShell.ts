/**
 * The app shell (ghui pattern): all state, derivations, async actions,
 * keymap wiring, and side-effects live here. Components consume the returned
 * bundle and stay pure JSX.
 *
 * Async flows read the latest state through `stateRef` (updated every
 * render) and write through functional setState, so keymap actions and
 * palette dispatch never operate on stale captures.
 */

import { Effect, Exit, ManagedRuntime, Schema } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ScraperService, fetchBookingOptions,
  startMultiCitySession, fetchCurrentLegOptions, chooseLegOption, isMultiCitySessionComplete
} from "../../services"
import { ScrapeRequestSchema, ScraperErrors } from "../../domain"
import type { FlightLeg, FlightOption, Passengers, ScrapeRequest, ScraperError, SeatClass, TripType } from "../../domain"
import { openInBrowser, buildGoogleFlightsUrl } from "../browser"
import { sortFlightsByColumn, TABLE_COLUMNS } from "../format"
import { footerHints, spinnerFrame, SPINNER_INTERVAL_MS, type HintItem, type HintsContext } from "../hints"
import { formatSequence, isBindingActive } from "../keymap"
import { appKeymap, type AppCtx } from "../keymaps"
import { keylog, useOpenTuiKeymap } from "../keys-adapter"
import { MAX_ADDITIONAL_LEGS, type LegDraft, type MultiCityFlowState } from "../state"

export type AppRuntime = ManagedRuntime.ManagedRuntime<ScraperService | HttpClient.HttpClient, never>

export interface FormState {
  readonly origin: string
  readonly destination: string
  readonly departDate: string
  readonly returnDate: string
  readonly tripType: TripType
  readonly seatClass: SeatClass
  readonly passengers: Passengers
  readonly legs: readonly LegDraft[]
}

export interface TableState {
  readonly inTableMode: boolean
  readonly selectedRow: number
  readonly selectedCol: number
  readonly sortColumn: string
  readonly sortAsc: boolean
}

export interface PaletteState {
  readonly open: boolean
  readonly returnMode: "form" | "table"
  readonly selected: number
  readonly filter: string
}

export interface ShellState {
  readonly form: FormState
  readonly focusIndex: number
  readonly isSearching: boolean
  readonly spinnerLabel: string
  readonly spinnerTick: number
  readonly results: readonly FlightOption[]
  readonly priceLevel?: "low" | "typical" | "high" | undefined
  readonly errorMessage?: string | undefined
  readonly status: string
  readonly lastRequest?: ScrapeRequest | undefined
  readonly multiCityFlow?: MultiCityFlowState | undefined
  readonly multiCityLegs?: readonly FlightLeg[] | undefined
  readonly table: TableState
  readonly palette: PaletteState
}

export interface PaletteEntry {
  readonly id: string
  readonly title: string
  readonly keys: string
  readonly status: true | string
}

export type ResultsView = "placeholder" | "loading" | "error" | "table"

const MAX_STOPS_DEFAULT = 2
const RESULT_LIMIT_DEFAULT = 10

const initialShellState: ShellState = {
  form: {
    origin: "JFK",
    destination: "LHR",
    departDate: "2026-01-25",
    returnDate: "2026-01-30",
    tripType: "one-way",
    seatClass: "economy",
    passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
    legs: [],
  },
  focusIndex: 0,
  isSearching: false,
  spinnerLabel: "Searching...",
  spinnerTick: 0,
  results: [],
  status: "",
  table: { inTableMode: false, selectedRow: 0, selectedCol: 0, sortColumn: "price", sortAsc: true },
  palette: { open: false, returnMode: "form", selected: 0, filter: "" },
}

/** "JFK → LHR" (or "JFK → LHR → CDG" for multi-city), with placeholders while empty */
export const routeSummary = (form: FormState): string => {
  const stop = (code: string) => (code.trim() ? code.toUpperCase() : "···")
  const stops = [form.origin, form.destination]
  if (form.tripType === "multi-city") {
    for (const leg of form.legs) stops.push(leg.to)
  }
  return stops.map(stop).join(" → ")
}

/** Ordered focusable form fields for the current trip type */
export const focusIdsFor = (form: FormState): readonly string[] => [
  "origin",
  "destination",
  "tripType",
  "departDate",
  ...(form.tripType === "round-trip" ? ["returnDate"] : []),
  ...(form.tripType === "multi-city"
    ? form.legs.flatMap((_, index) => [`leg-${index}-from`, `leg-${index}-to`, `leg-${index}-date`])
    : []),
  "seatClass",
  "adults",
  "children",
  "infantsSeat",
  "infantsLap",
]

/** Raw (unvalidated) request from form state; optional keys only when the trip type calls for them */
const buildCandidate = (form: FormState): unknown => ({
  from: (form.origin || "JFK").toUpperCase(),
  to: (form.destination || "LHR").toUpperCase(),
  departDate: form.departDate || "2026-08-20",
  tripType: form.tripType,
  ...(form.tripType === "round-trip" ? { returnDate: form.returnDate || "2026-08-27" } : {}),
  sortOption: "none",
  filters: { max_stops: MAX_STOPS_DEFAULT, limit: RESULT_LIMIT_DEFAULT },
  seat: form.seatClass,
  passengers: form.passengers,
  currency: "USD",
  ...(form.tripType === "multi-city"
    ? { additionalLegs: form.legs.map((leg) => ({ from: leg.from.toUpperCase(), to: leg.to.toUpperCase(), date: leg.date })) }
    : {}),
})

const decodeRequest = (candidate: unknown): Effect.Effect<ScrapeRequest, ScraperError> =>
  Schema.decodeUnknownEffect(ScrapeRequestSchema)(candidate).pipe(
    Effect.mapError((error) =>
      ScraperErrors.invalidInput("search form", error instanceof Error ? error.message : String(error))
    )
  )

export const useAppShell = (runtime: AppRuntime) => {
  const [state, setState] = useState<ShellState>(initialShellState)
  const stateRef = useRef(state)
  stateRef.current = state

  // Declared before buildAppCtx (which reads it during render); populated
  // after the palette-entries memo below.
  const paletteEntriesRef = useRef<readonly PaletteEntry[]>([])

  const update = (fn: (prev: ShellState) => ShellState) => setState(fn)

  const flash = (message: string) => update((s) => ({ ...s, status: message }))

  // ---- Form actions ----

  const patchForm = (patch: Partial<FormState>) =>
    update((s) => ({ ...s, form: { ...s.form, ...patch } }))

  const setTripType = (tripType: TripType) =>
    update((s) => ({
      ...s,
      form: {
        ...s.form,
        tripType,
        legs: tripType === "multi-city" && s.form.legs.length === 0
          ? [{ from: "", to: "", date: s.form.departDate }]
          : s.form.legs,
      },
    }))

  const patchLeg = (index: number, patch: Partial<LegDraft>) =>
    update((s) => ({
      ...s,
      form: {
        ...s.form,
        legs: s.form.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)),
      },
    }))

  const addLeg = () =>
    update((s) => ({
      ...s,
      form: { ...s.form, legs: [...s.form.legs, { from: "", to: "", date: s.form.departDate }] },
    }))

  const removeLeg = () =>
    update((s) => ({ ...s, form: { ...s.form, legs: s.form.legs.slice(0, -1) } }))

  const focusMove = (delta: number) =>
    update((s) => {
      const ids = focusIdsFor(s.form)
      return { ...s, focusIndex: (s.focusIndex + delta + ids.length) % ids.length }
    })

  // ---- Table actions ----

  const enterTable = () =>
    update((s) =>
      s.results.length === 0
        ? s
        : {
            ...s,
            table: { ...s.table, inTableMode: true, selectedRow: 0, selectedCol: 0 },
            status: "",
          }
    )

  const exitTable = () =>
    update((s) => ({
      ...s,
      table: { ...s.table, inTableMode: false },
      status: "",
    }))

  const moveRow = (delta: number) =>
    update((s) => ({
      ...s,
      table: {
        ...s.table,
        selectedRow: Math.max(-1, Math.min(s.results.length - 1, s.table.selectedRow + delta)),
      },
    }))

  const moveCol = (delta: number) =>
    update((s) => ({
      ...s,
      table: { ...s.table, selectedCol: Math.max(0, Math.min(TABLE_COLUMNS.length - 1, s.table.selectedCol + delta)) },
    }))

  const setRow = (row: number) =>
    update((s) => ({
      ...s,
      table: { ...s.table, selectedRow: Math.max(0, Math.min(s.results.length - 1, row)) },
    }))

  const sortByCurrentColumn = () =>
    update((s) => {
      const column = TABLE_COLUMNS[s.table.selectedCol]
      if (!column?.sortable) return s
      const key = column.key
      return {
        ...s,
        table: {
          ...s.table,
          sortColumn: key,
          sortAsc: s.table.sortColumn === key ? !s.table.sortAsc : true,
        },
      }
    })

  // ---- Search flows ----

  const startSearching = (label: string) =>
    update((s) => ({
      ...s,
      isSearching: true,
      spinnerLabel: label,
      errorMessage: undefined,
    }))

  const doSearch = async () => {
    const snap = stateRef.current
    keylog({ doSearch: "called", isSearching: snap.isSearching })
    if (snap.isSearching) return
    const candidate = buildCandidate(snap.form)

    if (snap.form.tripType === "multi-city") {
      await doMultiCityStart(candidate)
      return
    }

    update((s) => ({ ...s, multiCityFlow: undefined, multiCityLegs: undefined }))
    startSearching(`Searching ${routeSummary(snap.form)}...`)

    const program = Effect.gen(function* () {
      const request = yield* decodeRequest(candidate)
      const scraper = yield* ScraperService
      const result = yield* scraper.scrape(request)
      return { request, result }
    })

    const exit = await runtime.runPromiseExit(program)

    if (Exit.isSuccess(exit)) {
      const { request, result } = exit.value
      update((s) => ({
        ...s,
        isSearching: false,
        results: result.flights,
        priceLevel: result.current_price,
        lastRequest: request,
        status: "",
        table: { ...s.table, selectedRow: 0, selectedCol: 0 },
      }))
    } else {
      update((s) => ({ ...s, isSearching: false, errorMessage: `${exit.cause}`, status: "" }))
    }
  }

  const doMultiCityStart = async (candidate: unknown) => {
    update((s) => ({ ...s, multiCityFlow: undefined, multiCityLegs: undefined, results: [] }))
    startSearching(`Searching ${routeSummary(stateRef.current.form)}...`)

    const program = Effect.gen(function* () {
      const request = yield* decodeRequest(candidate)
      const session = yield* startMultiCitySession({
        from: request.from,
        to: request.to,
        departDate: request.departDate,
        additionalLegs: request.additionalLegs ?? [],
        seat: request.seat,
        passengers: request.passengers,
        currency: request.currency,
      })
      const options = yield* fetchCurrentLegOptions(session)
      return { request, session, options }
    })

    const exit = await runtime.runPromiseExit(program)

    if (Exit.isSuccess(exit) && exit.value.options.length > 0) {
      const { request, session, options } = exit.value
      update((s) => ({
        ...s,
        isSearching: false,
        lastRequest: request,
        multiCityFlow: { session, options, chosenFlights: [] },
        results: options.map((option) => option.flight),
        priceLevel: undefined,
        status: "",
        table: { ...s.table, selectedRow: 0, selectedCol: 0 },
      }))
    } else if (Exit.isSuccess(exit)) {
      update((s) => ({
        ...s,
        isSearching: false,
        errorMessage: `No flights found for leg 1 (${stateRef.current.form.origin} -> ${stateRef.current.form.destination})`,
        status: "",
      }))
    } else {
      update((s) => ({ ...s, isSearching: false, errorMessage: `${exit.cause}`, status: "" }))
    }
  }

  const chooseMultiCityLeg = async (flight: FlightOption) => {
    const snap = stateRef.current
    const flow = snap.multiCityFlow
    if (!flow) return
    const choice = flow.options.find((option) => option.flight.flight_number === flight.flight_number)
    if (!choice) return

    const chosenFlights = [...flow.chosenFlights, choice.flight]
    const session = chooseLegOption(flow.session, choice)

    if (isMultiCitySessionComplete(session)) {
      update((s) => ({
        ...s,
        multiCityFlow: undefined,
        multiCityLegs: [...session.legs],
        results: chosenFlights,
        status: "",
        table: { ...s.table, selectedRow: 0, selectedCol: 0 },
      }))
      return
    }

    update((s) => ({ ...s, results: [] }))
    startSearching(`Fetching leg ${session.legIndex + 1} of ${session.legs.length}...`)

    const exit = await runtime.runPromiseExit(fetchCurrentLegOptions(session))

    if (Exit.isSuccess(exit) && exit.value.length > 0) {
      const options = exit.value
      update((s) => ({
        ...s,
        isSearching: false,
        multiCityFlow: { session, options, chosenFlights },
        results: options.map((option) => option.flight),
        status: "",
        table: { ...s.table, selectedRow: 0, selectedCol: 0 },
      }))
    } else {
      update((s) => ({
        ...s,
        isSearching: false,
        multiCityFlow: undefined,
        errorMessage: Exit.isSuccess(exit) ? `No flights found for leg ${session.legIndex + 1}` : `${exit.cause}`,
        status: "",
      }))
    }
  }

  // Opens the cheapest booking option for a flight, falling back to its
  // deep_link, then to a generic search URL built from the last request.
  const openFlight = async (flight: FlightOption, leg?: FlightLeg) => {
    const request = stateRef.current.lastRequest

    if (flight.flight_number && request) {
      flash("Looking up booking options...")

      const exit = await runtime.runPromiseExit(
        fetchBookingOptions({
          from: leg?.from ?? request.from,
          to: leg?.to ?? request.to,
          date: leg?.date ?? request.departDate,
          flightNumber: flight.flight_number,
          seat: request.seat,
          passengers: request.passengers,
          currency: "USD",
        })
      )

      if (Exit.isSuccess(exit) && exit.value.length > 0) {
        const cheapest = exit.value.reduce((best, option) => {
          const bestPrice = parseFloat(best.price?.replace(/[^0-9.]/g, "") ?? "")
          const optionPrice = parseFloat(option.price?.replace(/[^0-9.]/g, "") ?? "")
          return !isNaN(optionPrice) && (isNaN(bestPrice) || optionPrice < bestPrice) ? option : best
        })
        openInBrowser(cheapest.url)
        flash(`Opening ${cheapest.provider}${cheapest.price ? ` (${cheapest.price})` : ""} in your browser...`)
        return
      }
    }

    if (flight.deep_link) {
      openInBrowser(flight.deep_link)
      flash(`Opening ${flight.name} in your browser...`)
      return
    }

    if (!request) return
    const url = await buildGoogleFlightsUrl(
      request.from, request.to, request.departDate, request.tripType,
      request.returnDate, request.seat, request.passengers
    )
    openInBrowser(url)
    flash("No direct link for this flight - opening the search in your browser...")
  }

  const activateRow = () => {
    const snap = stateRef.current
    if (snap.table.selectedRow < 0 || snap.table.selectedRow >= snap.results.length) return
    const sorted = sortFlightsByColumn([...snap.results], snap.table.sortColumn, snap.table.sortAsc)
    const selectedFlight = sorted[snap.table.selectedRow]

    if (snap.multiCityFlow && !isMultiCitySessionComplete(snap.multiCityFlow.session)) {
      void chooseMultiCityLeg(selectedFlight)
    } else if (snap.multiCityLegs) {
      const legIndex = snap.results.indexOf(selectedFlight)
      void openFlight(selectedFlight, snap.multiCityLegs[legIndex])
    } else {
      void openFlight(selectedFlight)
    }
  }

  // ---- Command palette ----

  const openPalette = () =>
    update((s) => ({
      ...s,
      palette: { open: true, returnMode: s.table.inTableMode ? "table" : "form", selected: 0, filter: "" },
    }))

  const closePalette = () =>
    update((s) => ({ ...s, palette: { ...s.palette, open: false } }))

  const setPaletteFilter = (filter: string) =>
    update((s) => ({ ...s, palette: { ...s.palette, filter, selected: 0 } }))

  const movePaletteSelection = (delta: number) =>
    update((s) => {
      const count = paletteEntriesRef.current.length
      const selected = Math.max(0, Math.min(count - 1, s.palette.selected + delta))
      return { ...s, palette: { ...s.palette, selected } }
    })

  // Runs the selected palette entry through the exact gating a keypress gets,
  // evaluated against the mode the palette opened from (setState is async, so
  // dispatcher.runById would still see palette mode here).
  const runPaletteSelection = () => {
    const snap = stateRef.current
    const entry = paletteEntriesRef.current[snap.palette.selected]
    closePalette()
    if (!entry) return
    const binding = appKeymap.bindings.find((b) => b.meta?.id === entry.id)
    if (!binding) return
    const background = buildAppCtx(snap.palette.returnMode)
    const status = isBindingActive(binding, background)
    if (status === true) binding.action(background)
    else flash(status)
  }

  // ---- Keymap context ----

  function buildAppCtx(mode: AppCtx["mode"]): AppCtx {
    const s = stateRef.current
    return {
      mode,
      form: {
        isSearching: s.isSearching,
        hasResults: s.results.length > 0,
        isMultiCity: s.form.tripType === "multi-city",
        canAddLeg: s.form.legs.length < MAX_ADDITIONAL_LEGS,
        canRemoveLeg: s.form.legs.length > 1,
        search: () => { void doSearch() },
        enterTable: enterTable,
        focusNext: () => focusMove(1),
        focusPrev: () => focusMove(-1),
        addLeg,
        removeLeg,
        openPalette,
      },
      table: {
        rowCount: s.results.length,
        selectedRow: s.table.selectedRow,
        isPickingLeg: s.multiCityFlow !== undefined && !isMultiCitySessionComplete(s.multiCityFlow.session),
        moveRow,
        moveCol,
        setRow,
        sortByCurrentColumn,
        activate: activateRow,
        exit: exitTable,
        openPalette,
      },
      palette: {
        entryCount: paletteEntriesRef.current.length,
        move: movePaletteSelection,
        run: runPaletteSelection,
        close: closePalette,
      },
    }
  }

  const mode: AppCtx["mode"] = state.palette.open ? "palette" : state.table.inTableMode ? "table" : "form"

  useOpenTuiKeymap(appKeymap, buildAppCtx(mode), flash)

  // ---- Palette entries (derived) ----

  const paletteEntries = useMemo((): readonly PaletteEntry[] => {
    if (!state.palette.open) return []
    const background = buildAppCtx(state.palette.returnMode)
    const byId = new Map<string, { title: string; keys: string[]; status: true | string }>()

    for (const binding of appKeymap.bindings) {
      const id = binding.meta?.id
      const title = binding.meta?.title
      if (!id || !title) continue
      const status = isBindingActive(binding, background)
      // Out of scope = belongs to another mode: meaningless to list, unlike
      // "disabled" which has a reason worth showing.
      if (status === "out of scope") continue
      const existing = byId.get(id)
      if (existing) existing.keys.push(formatSequence(binding.sequence))
      else byId.set(id, { title, keys: [formatSequence(binding.sequence)], status })
    }

    const query = state.palette.filter.trim().toLowerCase()
    return [...byId.entries()]
      .map(([id, entry]) => ({ id, title: entry.title, keys: entry.keys.join(", "), status: entry.status }))
      .filter((entry) => query === "" || entry.title.toLowerCase().includes(query) || entry.id.includes(query))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  paletteEntriesRef.current = paletteEntries

  // ---- Spinner ----

  useEffect(() => {
    if (!state.isSearching) return
    const timer = setInterval(
      () => update((s) => ({ ...s, spinnerTick: s.spinnerTick + 1 })),
      SPINNER_INTERVAL_MS
    )
    return () => clearInterval(timer)
  }, [state.isSearching])


  // ---- Derivations for rendering ----

  const focusIds = focusIdsFor(state.form)
  const focusId = state.palette.open || state.table.inTableMode
    ? null
    : focusIds[Math.min(state.focusIndex, focusIds.length - 1)]

  const hintsCtx: HintsContext = {
    mode,
    isSearching: state.isSearching,
    spinnerTick: state.spinnerTick,
    hasResults: state.results.length > 0,
    isMultiCity: state.form.tripType === "multi-city",
    canAddLeg: state.form.legs.length < MAX_ADDITIONAL_LEGS,
    canRemoveLeg: state.form.legs.length > 1,
    isPickingLeg: state.multiCityFlow !== undefined && !isMultiCitySessionComplete(state.multiCityFlow.session),
    legLabel: state.multiCityFlow
      ? `leg ${state.multiCityFlow.session.legIndex + 1}/${state.multiCityFlow.session.legs.length}`
      : undefined,
  }
  const hints: readonly HintItem[] = footerHints(hintsCtx)

  const statusDisplay = state.isSearching
    ? `${spinnerFrame(state.spinnerTick)} ${state.spinnerLabel}`
    : state.status

  const resultsView: ResultsView = state.isSearching
    ? "loading"
    : state.errorMessage !== undefined
      ? "error"
      : state.results.length > 0
        ? "table"
        : "placeholder"

  const sortedFlights = useMemo(
    () => sortFlightsByColumn([...state.results], state.table.sortColumn, state.table.sortAsc),
    [state.results, state.table.sortColumn, state.table.sortAsc]
  )

  const route = routeSummary(state.form)
  const paxCount =
    state.form.passengers.adults + state.form.passengers.children +
    state.form.passengers.infants_in_seat + state.form.passengers.infants_on_lap
  const tripSummary = `${state.form.tripType} · ${state.form.seatClass} · ${paxCount} pax`

  return {
    state,
    mode,
    focusId,
    hints,
    statusDisplay,
    resultsView,
    sortedFlights,
    paletteEntries,
    route,
    tripSummary,
    actions: {
      patchForm,
      setTripType,
      patchLeg,
      performSearch: () => { void doSearch() },
      setPaletteFilter,
    },
  }
}

export type AppShell = ReturnType<typeof useAppShell>
