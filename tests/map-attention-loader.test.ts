import { expect, it } from "vitest";
import { loadMapAttention } from "../src/client/map-attention-loader";
import { ApiError } from "../src/client/api";
import type { MapAttentionPage, MapAttentionTask } from "../src/shared/map-attention";
const task = (id: string): MapAttentionTask => ({ id, mine: true, status: "PLANNING", dueAt: null, hasDefects: false });
it("loads all 10000 metadata records in ten bounded scoped pages", async () => {
  const rows = Array.from({ length: 10000 }, (_, index) => ({ ...task(String(index).padStart(5, "0")), mine: index % 3 === 0 }));
  const paths: string[] = [];
  const result = await loadMapAttention("country", "city", new AbortController().signal, async path => {
    paths.push(path);
    const query = new URL(path, "http://localhost").searchParams;
    expect(query.get("countryId")).toBe("country");
    expect(query.get("cityId")).toBe("city");
    expect(query.get("revision")).toBe(paths.length === 1 ? null : "7");
    const start = query.has("after") ? Number(query.get("after")) + 1 : 0;
    const limit = Number(query.get("limit") ?? 250);
    const tasks = rows.slice(start, start + limit);
    return { revision: 7, tasks, next: start + limit < rows.length ? tasks.at(-1)!.id : null };
  });
  expect(result).toEqual(rows);
  expect(new Set(result.map(row => row.id)).size).toBe(10000);
  expect(result.filter(row => row.mine)).toHaveLength(3334);
  expect(paths).toHaveLength(10);
  expect(paths.every(path => new URL(path, "http://localhost").searchParams.get("limit") === "1000")).toBe(true);
});
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
it("does not publish a page or request its successor after an in-flight abort", async () => {
  const controller = new AbortController(); let calls = 0;
  await expect(loadMapAttention("country", "city", controller.signal, async () => {
    calls++; controller.abort();
    return { revision: 1, tasks: [task("a")], next: "a" };
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});
it("fails after exactly one snapshot restart under continuous edits", async () => {
  let calls = 0;
  await expect(loadMapAttention("country", "city", new AbortController().signal, async () => {
    calls++; throw new ApiError(409, "changed");
  })).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(2);
});
