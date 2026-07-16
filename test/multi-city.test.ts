/**
 * The multi-city picker through its seam, over a fake HttpClient: a canned
 * search page provides the RPC session, and a canned GetShoppingResults
 * response provides both legs' bookable options. No network.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AirportCodeSchema, DateStringSchema, FlightLegSchema, type AirportCode, type DateString } from "../src/domain"
import { chooseMultiCityOption, fetchMultiCityItinerary, startMultiCityPicker, type MultiCityParams } from "../src/services/multi-city"

const airport = (code: string): AirportCode => Schema.decodeUnknownSync(AirportCodeSchema)(code)
const date = (value: string): DateString => Schema.decodeUnknownSync(DateStringSchema)(value)

/** A provider entry: one bookable flight in Google's response layout */
const providerEntry = (options: { from: string; to: string; name: string; price: number; carrier: string; number: string; token: string }): unknown => {
  const flight = Array.from({ length: 23 }, () => null)
  flight[3] = options.from
  flight[6] = options.to
  flight[8] = [8, 25]
  flight[10] = [11, 40]
  flight[11] = 195
  flight[22] = [options.carrier, options.number]
  return [
    [options.carrier, [options.name], [flight]],
    [[null, options.price], options.token],
  ]
}

const SEARCH_PAGE_HTML = [`{"cfb2h":"boq_test_bl","FdrFJe":"-42"}`, `"H${"a".repeat(40)}AAAAAG${"b".repeat(10)}"`].join("\n")

/** One canned RPC response containing provider groups for both legs */
const shoppingResponse = (): string => {
  const leg1 = [
    providerEntry({ from: "JFK", to: "LHR", name: "British Airways", price: 480, carrier: "BA", number: "178", token: "TOK-BA" }),
    providerEntry({ from: "JFK", to: "LHR", name: "Norse Atlantic", price: 210, carrier: "N0", number: "701", token: "TOK-N0" }),
  ]
  const leg2 = [providerEntry({ from: "LHR", to: "CDG", name: "Air France", price: 95, carrier: "AF", number: "1681", token: "TOK-AF" }), null]
  const payload = [null, [leg1, leg2]]
  return `)]}'\n\n${JSON.stringify([["wrb.fr", null, JSON.stringify(payload)]])}\n`
}

/** Fake transport: search pages get the session HTML, RPC posts get options */
const FakeHttpClient = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(request.method === "GET" ? SEARCH_PAGE_HTML : shoppingResponse())))),
)

const params: MultiCityParams = {
  from: airport("JFK"),
  to: airport("LHR"),
  departDate: date("2026-08-20"),
  additionalLegs: [Schema.decodeUnknownSync(FlightLegSchema)({ from: "LHR", to: "CDG", date: "2026-08-24" })],
  seat: "economy",
  passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
}

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) => Effect.runPromise(effect.pipe(Effect.provide(FakeHttpClient)) as Effect.Effect<A, E>)

describe("multi-city picker", () => {
  test("start returns leg 1's options with the step context", async () => {
    const step = await run(startMultiCityPicker(params))

    expect(step._tag).toBe("PickLeg")
    if (step._tag !== "PickLeg") return
    expect(step.legIndex).toBe(0)
    expect(step.legCount).toBe(2)
    expect(step.leg.from).toBe("JFK")
    expect(step.options.map((o) => o.flight.name)).toEqual(["British Airways", "Norse Atlantic"])
    expect(step.options[0].flight.flight_number).toBe("BA178")
    expect(step.options[0].flight.departure).toBe("8:25 AM")
  })

  test("choosing walks legs and completes with flights paired to their legs", async () => {
    const itinerary = await run(
      Effect.gen(function* () {
        let step = yield* startMultiCityPicker(params)
        expect(step._tag).toBe("PickLeg")
        if (step._tag !== "PickLeg") throw new Error("unreachable")

        // Pick the expensive leg-1 option deliberately (not the cheapest)
        const ba = step.options.find((o) => o.flight.name === "British Airways")!
        step = yield* chooseMultiCityOption(step, ba)

        expect(step._tag).toBe("PickLeg")
        if (step._tag !== "PickLeg") throw new Error("unreachable")
        expect(step.legIndex).toBe(1)
        expect(step.leg.from).toBe("LHR")
        expect(step.chosen.length).toBe(1)

        step = yield* chooseMultiCityOption(step, step.options[0])
        expect(step._tag).toBe("Complete")
        if (step._tag !== "Complete") throw new Error("unreachable")
        return step.itinerary
      }),
    )

    expect(itinerary.map((entry) => entry.flight.name)).toEqual(["British Airways", "Air France"])
    expect(itinerary.map((entry) => `${entry.leg.from}-${entry.leg.to}`)).toEqual(["JFK-LHR", "LHR-CDG"])
  })

  test("the greedy itinerary picks the cheapest option per leg", async () => {
    const result = await run(fetchMultiCityItinerary(params))
    expect(result.flights.map((f) => f.name)).toEqual(["Norse Atlantic", "Air France"])
    expect(result.flights.map((f) => f.price)).toEqual(["$210", "$95"])
  })
})
