/**
 * Search-page parsing through its real interface: a synthetic HTML fixture
 * with the DOM shapes and AF_initDataCallback blob the parser reads,
 * including a hand-built protobuf booking token for designator decoding.
 */
import { describe, expect, test } from "bun:test"
import { FlightOption } from "../src/domain"
import { applyFiltersSortAndLimit, filterFlights, parseHtmlFallback, sortFlights } from "../src/services/flight-parsing"

/**
 * A booking token as Google encodes it: a protobuf message whose field 2 is
 * the flight's designator. Field 1 is padded so the base64 starts with "Cj",
 * matching the token shape the parser looks for.
 */
const bookingToken = (designator: string): string => {
  const field1 = new TextEncoder().encode("x".repeat(50))
  const field2 = new TextEncoder().encode(designator)
  const bytes = Uint8Array.from([
    0x0a, field1.length, ...field1,
    0x12, field2.length, ...field2,
  ])
  const token = Buffer.from(bytes).toString("base64")
  expect(token).toStartWith("Cj")
  return token
}

const fixtureHtml = (options: { clientId: string; designator: string }): string => `
<html><head><script>
AF_initDataCallback({key: 'ds:2', hash: '3', data:[[[null,7],"${bookingToken(options.designator)}"],["${options.clientId}"]], sideChannel: {}});
</script></head><body>
<span class="gOatQ">Prices are currently low</span>
<div jsname="IWWDBc"><ul class="Rk10dc">
<li ssk="1:${options.clientId}">
  <div class="sSHqwe tPgKwe ogfYpf"><span>British Airways</span></div>
  <span class="mv1WYe"><div>8:20 AM on Thu, Aug 20</div><div>8:15 PM on Thu, Aug 20</div></span>
  <div class="gvkrdb">6 hr 55 min</div>
  <div class="BbR8Ec"><div class="ogfYpf">Nonstop</div></div>
  <div class="YMlIz FpEdX"><span>$249</span></div>
</li>
<li ssk="1:other01">
  <div class="sSHqwe tPgKwe ogfYpf"><span>Iberia</span></div>
  <span class="mv1WYe"><div>1:25 PM on Thu, Aug 20</div><div>4:55 AM on Fri, Aug 21</div></span>
  <span class="bOzv6">+1</span>
  <div class="gvkrdb">15 hr 30 min</div>
  <div class="BbR8Ec"><div class="ogfYpf">2 stops</div></div>
  <div class="YMlIz FpEdX"><span>$146</span></div>
</li>
</ul></div>
</body></html>`

describe("parseHtmlFallback", () => {
  const result = parseHtmlFallback(fixtureHtml({ clientId: "abc-123", designator: "BA178" }))

  test("extracts every flight card", () => {
    expect(result.flights.length).toBe(2)
    const [best, second] = result.flights
    expect(best.name).toBe("British Airways")
    expect(best.is_best).toBe(true)
    expect(best.price).toBe("$249")
    expect(best.stops).toBe(0)
    expect(best.duration).toBe("6 hr 55 min")
    expect(second.name).toBe("Iberia")
    expect(second.stops).toBe(2)
    expect(second.arrival_time_ahead).toBe("+1")
  })

  test("decodes the flight designator from the booking token", () => {
    expect(result.flights[0].flight_number).toBe("BA178")
    expect(result.flights[1].flight_number).toBeUndefined()
  })

  test("reads the price indicator", () => {
    expect(result.current_price).toBe("low")
  })
})

describe("filtering and sorting", () => {
  const flights = [
    FlightOption.make({ name: "Delta", departure: "", arrival: "", duration: "10 hr", stops: 1, price: "$300" }),
    FlightOption.make({ name: "United", departure: "", arrival: "", duration: "7 hr 30 min", stops: 0, price: "$450" }),
    FlightOption.make({ name: "Iberia", departure: "", arrival: "", duration: "15 hr", stops: 2, price: "$150" }),
  ]

  test("sortFlights orders by parsed price", () => {
    expect(sortFlights(flights, "price-asc").map((f) => f.name)).toEqual(["Iberia", "Delta", "United"])
    expect(sortFlights(flights, "duration-asc").map((f) => f.name)).toEqual(["United", "Delta", "Iberia"])
  })

  test("filterFlights applies price, stops, and airline filters", () => {
    expect(filterFlights(flights, { maxPrice: 350 }).map((f) => f.name)).toEqual(["Delta", "Iberia"])
    expect(filterFlights(flights, { nonstopOnly: true }).map((f) => f.name)).toEqual(["United"])
    expect(filterFlights(flights, { airlines: ["delta"] }).map((f) => f.name)).toEqual(["Delta"])
    expect(filterFlights(flights, { maxDurationMinutes: 8 * 60 }).map((f) => f.name)).toEqual(["United"])
  })

  test("applyFiltersSortAndLimit composes all three", () => {
    const result = applyFiltersSortAndLimit(
      { flights },
      { maxPrice: 500, limit: 2 },
      "price-asc"
    )
    expect(result.flights.map((f) => f.name)).toEqual(["Iberia", "Delta"])
  })
})
