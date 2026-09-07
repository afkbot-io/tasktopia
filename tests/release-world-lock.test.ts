import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withReleaseWorldLock } from "../src/server/release-world-lock";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";

describe("release world lock", () => {
  it("holds one pinned transaction throughout work and rejects another runner", async () => {
    const name = `test-release:${randomUUID()}`;
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const first = withReleaseWorldLock(databaseUrl, async () => { started(); await wait; return "finished"; }, name);
    await ready;
    try {
      await expect(withReleaseWorldLock(databaseUrl, async () => "overlap", name)).rejects.toThrow("already running");
    } finally { release(); }
    await expect(first).resolves.toBe("finished");
    await expect(withReleaseWorldLock(databaseUrl, async () => "next", name)).resolves.toBe("next");
  });
  it("releases the same pinned lock on failure without leaking a connection", async () => {
    const name = `test-release:${randomUUID()}`;
    await expect(withReleaseWorldLock(databaseUrl, async () => { throw new Error("country failed"); }, name)).rejects.toThrow("country failed");
    await expect(withReleaseWorldLock(databaseUrl, async () => 42, name)).resolves.toBe(42);
  });
});
