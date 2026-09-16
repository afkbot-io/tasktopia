import { expect, it } from "vitest";
import { matchesMapAttention, type MapAttentionTask } from "../src/shared/map-attention";
it("includes assigned completed tasks and evaluates deadlines without events", () => {
  const t: MapAttentionTask = { id: "a", mine: true, status: "COMPLETED", dueAt: "2026-09-15T12:00:00Z", hasDefects: false };
  expect(matchesMapAttention(t, "MINE", 0)).toBe(true);
  expect(matchesMapAttention(t, "OVERDUE", Date.parse("2026-09-16"))).toBe(false);
  t.status = "TESTING";
  expect(matchesMapAttention(t, "TESTING", 0)).toBe(true);
  expect(matchesMapAttention(t, "OVERDUE", Date.parse("2026-09-15T11:59:59Z"))).toBe(false);
  expect(matchesMapAttention(t, "OVERDUE", Date.parse(t.dueAt!))).toBe(true);
  t.mine = false;
  expect(matchesMapAttention(t, "MINE", 0)).toBe(false);
});
