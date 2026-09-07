import { expect, it } from "vitest";
import { lightingAtHour } from "../src/shared/world-lighting";

it("uses the requested half-open Moscow time periods", () => {
  for (const [hour, phase] of [[0,"NIGHT"],[5.999,"NIGHT"],[6,"DAWN"],[9.999,"DAWN"],
    [10,"DAY"],[15.999,"DAY"],[16,"DUSK"],[17.999,"DUSK"],[18,"NIGHT"],[23.999,"NIGHT"]] as const) {
    expect(lightingAtHour(hour).phase, String(hour)).toBe(phase);
  }
});

it("keeps daylight neutral and switches lamps on at night with readable ambient light", () => {
  expect(lightingAtHour(12).tint).toBe(0xffffff);
  expect(lightingAtHour(12).lamps).toBe(0);
  expect(lightingAtHour(0).lamps).toBe(1);
  expect(lightingAtHour(0).shadowAlpha).toBe(0);
  expect(lightingAtHour(12).shadowAlpha).toBeCloseTo(.14);
  expect(lightingAtHour(8).shadowOffsetX).toBeLessThan(0);
  expect(lightingAtHour(16).shadowOffsetX).toBeGreaterThan(0);
  expect(lightingAtHour(0).brightness).toBeGreaterThan(.45);
  expect(lightingAtHour(6).phase).toBe("DAWN");
  expect(lightingAtHour(17).phase).toBe("DUSK");
  expect(lightingAtHour(6).lamps).toBe(1);
  expect(lightingAtHour(10).tint).toBe(0xffffff);
  expect(lightingAtHour(16).lamps).toBe(0);
  expect(lightingAtHour(18).lamps).toBe(1);
  expect(lightingAtHour(24)).toEqual(lightingAtHour(0));
  for (let hour = 0; hour < 24; hour += .01) {
    expect(Math.abs(lightingAtHour(hour).lamps - lightingAtHour(hour + .01).lamps)).toBeLessThan(.02);
  }
});
