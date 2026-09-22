import { afterEach, expect, it, vi } from "vitest";
import { readWorldLighting } from "../src/client/world-light-clock";
afterEach(() => vi.useRealTimers());

it("сохраняет дневное освещение при смене времени и возвращении во вкладку", () => {
  vi.useFakeTimers();
  for (const time of ["02:59:59", "03:00:00", "07:00:00", "13:00:00", "15:00:00"]) {
    vi.setSystemTime(new Date(`2026-09-06T${time}Z`));
    expect(readWorldLighting()).toMatchObject({ phase: "DAY", lamps: 0, tint: 0xffffff });
  }
});
