import { describe, expect, it } from "vitest";
import { cityMicroFlightDuration, cityMicroFlightPosition, cityMicroFlightRoutes, cityMicroFlightIsCurrent } from "../src/client/city-micro-flights";
import { connectCityAirports } from "../src/server/world/city-airport-connections";
import { CITY_AIRPORT_CONNECTION_LIMIT, type CityAirportEndpointDto } from "../src/shared/city-scene-contract";

const airport = (taskId: string, cityId: string, x: number, y: number): CityAirportEndpointDto => ({ taskId, cityId, point: { x, y } });

describe("task-backed compact city flights", () => {
  it("retains a current flight on equivalent scenes but cancels removed or relocated canonical endpoints", () => {
    const connection = { id: "a:b", from: airport("a", "home", 0, 0), to: airport("b", "away", 50, 0) };
    const old = cityMicroFlightRoutes([connection])[0]!;
    const snapshot = structuredClone(old);
    expect(cityMicroFlightIsCurrent(old, cityMicroFlightRoutes([structuredClone(connection)]))).toBe(true);
    expect(cityMicroFlightIsCurrent(old, [])).toBe(false);
    const moved = cityMicroFlightRoutes([{ ...connection, to: airport("b", "away", 90, 60) }]);
    expect(cityMicroFlightIsCurrent(old, moved)).toBe(false);
    const fineMove = cityMicroFlightRoutes([{ ...connection, to: airport("b", "away", 50.001, 0) }]);
    expect(fineMove[0]!.curve.path).toBe(old.curve.path); // rounded SVG path is not identity
    expect(cityMicroFlightIsCurrent(old, fineMove)).toBe(false);
    expect(old).toEqual(snapshot); // no in-flight teleport/retargeting
  });
  it("never invents endpoints from the viewport or an unpaired airport", () => {
    expect(cityMicroFlightRoutes([])).toEqual([]);
    expect(connectCityAirports("home", [airport("a", "home", 0, 0)])).toEqual([]);
    expect(connectCityAirports("unrelated", [airport("a", "home", 0, 0), airport("b", "away", 10, 10)])).toEqual([]);
  });
  it("joins actual cross-city airport coordinates in both directions and keeps authored headings", () => {
    const a = airport("a", "home", 0.5, 0.5), b = airport("b", "away", 10.5, 10.5);
    const routes = cityMicroFlightRoutes(connectCityAirports("home", [b, a, a]));
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ fromTaskId: "a", toTaskId: "b", length: Math.hypot(10, 10) });
    expect(cityMicroFlightPosition(routes[0]!, 0)).toMatchObject({ x: 0.5, y: 0.5, scale: .05 });
    expect(cityMicroFlightPosition(routes[0]!, 0.5).scale).toBe(1);
    expect(cityMicroFlightPosition(routes[0]!, 1)).toMatchObject({ x: 10.5, y: 10.5, scale: .05 });
    expect(cityMicroFlightPosition(routes[1]!, 1)).toMatchObject({ x: 0.5, y: 0.5, scale: .05 });
    expect(cityMicroFlightDuration(routes[0]!)).toBe(8_000);
    const samples = [.498, .499, .5, .501, .502].map(p => cityMicroFlightPosition(routes[0]!, p));
    for (let i = 1; i < samples.length - 1; i++) {
      const left = samples[i - 1]!, current = samples[i]!, right = samples[i + 1]!;
      // A quadratic curve has tiny continuous second differences, no L-corner.
      expect(Math.abs(right.x - 2 * current.x + left.x)).toBeLessThan(.001);
      expect(Math.abs(right.y - 2 * current.y + left.y)).toBeLessThan(.001);
      const dx = right.x - left.x, dy = right.y - left.y;
      const expected = Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? "west" : "east" : dy < 0 ? "north" : "south";
      // Exactly diagonal tangents sit on a compass boundary. Analytic and
      // finite-difference derivatives may round to opposite sides of that tie.
      if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-8) {
        expect([dx < 0 ? "west" : "east", dy < 0 ? "north" : "south"]).toContain(current.direction);
      } else {
        expect(current.direction).toBe(expected);
      }
    }
  });
  it("bounds route count and duration, retaining nearest actual airport pairs", () => {
    const local = airport("a", "home", -10, -20);
    const endpoints = [local, ...Array.from({ length: 20 }, (_, i) => airport(`remote-${i}`, `city-${i}`, i * 100 + 100, 20))];
    const connections = connectCityAirports("home", endpoints.reverse());
    expect(connections).toHaveLength(CITY_AIRPORT_CONNECTION_LIMIT);
    expect(new Set(connections.flatMap(c => [c.from.taskId, c.to.taskId]))).toEqual(new Set(["a", "remote-0", "remote-1", "remote-2", "remote-3"]));
    const far = cityMicroFlightRoutes([{ id: "far", from: local, to: airport("far", "far-city", 5000, 5000) }])[0]!;
    expect(cityMicroFlightDuration(far)).toBe(30_000);
    expect(cityMicroFlightPosition(far, 1)).toMatchObject({ x: 5000, y: 5000, scale: .05 });
  });
});
