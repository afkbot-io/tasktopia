import { expect, it } from "vitest";
import { loadMapAttention } from "../src/client/map-attention-loader";
import { ApiError } from "../src/client/api";
import type { MapAttentionPage, MapAttentionTask } from "../src/shared/map-attention";
const task = (id: string): MapAttentionTask => ({ id, mine: true, status: "PLANNING", dueAt: null, hasDefects: false });
it("discards an interrupted snapshot and restarts exactly once", async () => {
  const paths: string[] = [];
  const answers: (MapAttentionPage | Error)[] = [
    { revision: 1, tasks: [task("a")], next: "a" }, new ApiError(409, "changed"),
    { revision: 2, tasks: [task("b")], next: "b" }, { revision: 2, tasks: [task("c")], next: null },
  ];
  const result = await loadMapAttention("country", "city", new AbortController().signal, async path => {
    paths.push(path); const answer = answers.shift()!; if (answer instanceof Error) throw answer; return answer;
  });
  expect(result.map(t => t.id)).toEqual(["b", "c"]);
  expect(paths[1]).toContain("revision=1");
  expect(paths[2]).not.toContain("after");
  expect(paths[3]).toContain("revision=2");
});
it("never retries revoked access or publishes partial data", async () => {
  let calls = 0;
  await expect(loadMapAttention("country", "city", new AbortController().signal, async () => {
    calls++; if (calls === 1) return { revision: 1, tasks: [task("a")], next: "a" };
    throw new ApiError(403, "revoked");
  })).rejects.toMatchObject({ status: 403 });
  expect(calls).toBe(2);
});
it("stops on abort and cyclic cursors", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(loadMapAttention("country", "city", controller.signal, async () => { throw new Error("Must not fetch"); })).rejects.toMatchObject({ name: "AbortError" });
  await expect(loadMapAttention("country", "city", new AbortController().signal, async () => ({ revision: 1, tasks: [task("a")], next: "a" }))).rejects.toThrow("Repeated");
});
