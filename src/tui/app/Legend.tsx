/**
 * Footer legend: contextual key hints from the pure footerHints function.
 * Keys render in the hint-key color, labels muted, disabled hints dimmed.
 */

import { colors } from "../format"
import type { HintItem } from "../hints"

export const Legend = ({ items }: { readonly items: readonly HintItem[] }) => (
  <box width="100%" height={1} flexDirection="row" backgroundColor={colors.legendBg}>
    {items.map((item, index) => (
      <box key={`${item.key}-${item.label}`} flexDirection="row" flexShrink={0}>
        {index > 0 ? (
          <text wrapMode="none" fg={colors.border}>
            {" │ "}
          </text>
        ) : null}
        <text wrapMode="none" fg={item.disabled ? colors.muted : colors.hintKey}>
          {item.key}
        </text>
        <text wrapMode="none" fg={item.disabled ? colors.border : colors.muted}>{` ${item.label}`}</text>
      </box>
    ))}
  </box>
)
