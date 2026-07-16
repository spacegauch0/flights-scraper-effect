/**
 * The search form: route (from → to), trip type, dates (or multi-city legs),
 * cabin, and traveler counts. Pure render off the shell bundle; every
 * mutation goes through shell actions. Outcome messages live in the footer
 * status line, not here.
 */

import type { SeatClass, TripType } from "../../domain"
import { colors } from "../format"
import type { AppShell } from "./useAppShell"

const TRIP_OPTIONS = [
  { name: "One-way", description: "", value: "one-way" },
  { name: "Round-trip", description: "", value: "round-trip" },
  { name: "Multi-city", description: "", value: "multi-city" },
]
const TRIP_VALUES: readonly TripType[] = ["one-way", "round-trip", "multi-city"]

const SEAT_OPTIONS = [
  { name: "Economy", description: "", value: "economy" },
  { name: "Premium", description: "", value: "premium-economy" },
  { name: "Business", description: "", value: "business" },
  { name: "First", description: "", value: "first" },
]
const SEAT_VALUES: readonly SeatClass[] = ["economy", "premium-economy", "business", "first"]

const inputColors = {
  backgroundColor: colors.background,
  textColor: colors.text,
  focusedBackgroundColor: colors.focusBg,
  focusedTextColor: colors.text,
} as const

const selectColors = {
  backgroundColor: colors.background,
  textColor: colors.text,
  selectedBackgroundColor: colors.accent,
  selectedTextColor: colors.selectedText,
} as const

/** Field label, flush with its control; focus is shown by color alone */
const Label = ({ text, active }: { readonly text: string; readonly active: boolean }) => (
  <text wrapMode="none" fg={active ? colors.accent : colors.muted}>
    {text}
  </text>
)

const PassengerField = ({
  label,
  value,
  focused,
  onInput,
}: {
  readonly label: string
  readonly value: number
  readonly focused: boolean
  readonly onInput: (value: string) => void
}) => (
  <box width={6} flexDirection="column">
    <text wrapMode="none" fg={focused ? colors.accent : colors.muted}>
      {label}
    </text>
    <input width={5} value={String(value)} maxLength={2} focused={focused} onInput={onInput} {...inputColors} />
  </box>
)

const parseCount = (value: string, min: number): number => {
  const parsed = parseInt(value, 10)
  return isNaN(parsed) || parsed < min ? min : parsed
}

export const SearchForm = ({ shell }: { readonly shell: AppShell }) => {
  const { form } = shell.state
  const { focusId, actions } = shell
  const routeActive = focusId === "origin" || focusId === "destination"

  return (
    <box
      width={32}
      height="100%"
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={colors.border}
      padding={1}
      title=" search "
      titleAlignment="left"
      backgroundColor={colors.surface}
    >
      {/* Keyed by trip shape: adding/removing fields remounts the column
          (structural updates in place are unreliable in @opentui/react 0.4.2) */}
      <box key={`${form.tripType}-${form.legs.length}`} width="100%" flexDirection="column" gap={1}>
        <box width="100%" flexDirection="column">
          <Label text="Route" active={routeActive} />
          <box width="100%" flexDirection="row">
            <input
              width={6}
              value={form.origin}
              placeholder="JFK"
              maxLength={3}
              focused={focusId === "origin"}
              onInput={(value) => actions.patchForm({ origin: value.toUpperCase() })}
              {...inputColors}
            />
            <box width={3} height={1} justifyContent="center" flexDirection="row">
              <text fg={colors.accent}>{"→"}</text>
            </box>
            <input
              width={6}
              value={form.destination}
              placeholder="LHR"
              maxLength={3}
              focused={focusId === "destination"}
              onInput={(value) => actions.patchForm({ destination: value.toUpperCase() })}
              {...inputColors}
            />
          </box>
        </box>

        <box width="100%" flexDirection="column">
          <Label text="Trip" active={focusId === "tripType"} />
          <select
            width="100%"
            height={3}
            options={TRIP_OPTIONS}
            selectedIndex={Math.max(0, TRIP_VALUES.indexOf(form.tripType))}
            focused={focusId === "tripType"}
            onChange={(_, option) => {
              if (option) actions.setTripType(option.value as TripType)
            }}
            showDescription={false}
            wrapSelection
            {...selectColors}
          />
        </box>

        <box width="100%" flexDirection="column">
          <Label text="Depart" active={focusId === "departDate"} />
          <input
            width={13}
            value={form.departDate}
            placeholder="YYYY-MM-DD"
            maxLength={10}
            focused={focusId === "departDate"}
            onInput={(value) => actions.patchForm({ departDate: value })}
            {...inputColors}
          />
        </box>

        {form.tripType === "round-trip" ? (
          <box width="100%" flexDirection="column">
            <Label text="Return" active={focusId === "returnDate"} />
            <input
              width={13}
              value={form.returnDate}
              placeholder="YYYY-MM-DD"
              maxLength={10}
              focused={focusId === "returnDate"}
              onInput={(value) => actions.patchForm({ returnDate: value })}
              {...inputColors}
            />
          </box>
        ) : null}

        {form.tripType === "multi-city"
          ? form.legs.map((leg, index) => {
              const legActive = focusId === `leg-${index}-from` || focusId === `leg-${index}-to` || focusId === `leg-${index}-date`
              return (
                <box key={`leg-${index}`} width="100%" flexDirection="column">
                  <Label text={`Leg ${index + 2}`} active={legActive} />
                  <box width="100%" flexDirection="row" gap={1}>
                    <input
                      width={6}
                      value={leg.from}
                      placeholder="JFK"
                      maxLength={3}
                      focused={focusId === `leg-${index}-from`}
                      onInput={(value) => actions.patchLeg(index, { from: value.toUpperCase() })}
                      {...inputColors}
                    />
                    <input
                      width={6}
                      value={leg.to}
                      placeholder="LHR"
                      maxLength={3}
                      focused={focusId === `leg-${index}-to`}
                      onInput={(value) => actions.patchLeg(index, { to: value.toUpperCase() })}
                      {...inputColors}
                    />
                    <input
                      width={13}
                      value={leg.date}
                      placeholder="YYYY-MM-DD"
                      maxLength={10}
                      focused={focusId === `leg-${index}-date`}
                      onInput={(value) => actions.patchLeg(index, { date: value })}
                      {...inputColors}
                    />
                  </box>
                </box>
              )
            })
          : null}

        <box width="100%" flexDirection="column">
          <Label text="Cabin" active={focusId === "seatClass"} />
          <select
            width="100%"
            height={4}
            options={SEAT_OPTIONS}
            selectedIndex={Math.max(0, SEAT_VALUES.indexOf(form.seatClass))}
            focused={focusId === "seatClass"}
            onChange={(_, option) => {
              if (option) actions.patchForm({ seatClass: option.value as SeatClass })
            }}
            showDescription={false}
            wrapSelection
            {...selectColors}
          />
        </box>

        <box width="100%" flexDirection="column">
          <Label text="Travelers" active={focusId === "adults" || focusId === "children" || focusId === "infantsSeat" || focusId === "infantsLap"} />
          <box width="100%" flexDirection="row" gap={1}>
            <PassengerField
              label="Adult"
              value={form.passengers.adults}
              focused={focusId === "adults"}
              onInput={(value) => actions.patchForm({ passengers: { ...form.passengers, adults: parseCount(value, 1) } })}
            />
            <PassengerField
              label="Child"
              value={form.passengers.children}
              focused={focusId === "children"}
              onInput={(value) => actions.patchForm({ passengers: { ...form.passengers, children: parseCount(value, 0) } })}
            />
            <PassengerField
              label="Inf-S"
              value={form.passengers.infants_in_seat}
              focused={focusId === "infantsSeat"}
              onInput={(value) => actions.patchForm({ passengers: { ...form.passengers, infants_in_seat: parseCount(value, 0) } })}
            />
            <PassengerField
              label="Inf-L"
              value={form.passengers.infants_on_lap}
              focused={focusId === "infantsLap"}
              onInput={(value) => actions.patchForm({ passengers: { ...form.passengers, infants_on_lap: parseCount(value, 0) } })}
            />
          </box>
        </box>
      </box>
    </box>
  )
}
