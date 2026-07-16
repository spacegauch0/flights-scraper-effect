/**
 * App chrome: header with the live route strip (the app's signature), full
 * width dividers, and the footer status line. Content components stay
 * between one divider pair; everything here is one terminal row each.
 */

import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { colors } from "../format"

/** Full-width horizontal rule */
export const Divider = () => {
  const { width } = useTerminalDimensions()
  return (
    <box width="100%" height={1}>
      <text wrapMode="none" fg={colors.border}>
        {"─".repeat(Math.max(0, width - 2))}
      </text>
    </box>
  )
}

/**
 * Departure-board header: app name, the live route built from the form
 * ("JFK → LHR → CDG"), and the trip summary right of it.
 */
export const Header = ({ route, tripSummary }: { readonly route: string; readonly tripSummary: string }) => (
  <box width="100%" height={1} flexDirection="row">
    {/* Sibling text nodes, not spans: see Legend.tsx for why */}
    <text wrapMode="none" flexShrink={0} fg={colors.accent}>
      {"✈ flights  "}
    </text>
    <text wrapMode="none" flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>
      {route}
    </text>
    <text wrapMode="none" fg={colors.muted}>{`  ·  ${tripSummary}`}</text>
  </box>
)

/** One-line outcome report: what just happened, not what keys exist */
export const StatusLine = ({ text }: { readonly text: string }) => (
  <box width="100%" height={1}>
    <text wrapMode="none" fg={colors.muted}>
      {text || " "}
    </text>
  </box>
)
