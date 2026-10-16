import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { createRuntimeShutdown } from "../src/server/runtime-shutdown";
import { startBackgroundPoll } from "../src/server/background-poll";

const execute = promisify(execFile);
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
afterEach(() => { vi.useRealTimers(); });

it("stops every producer concurrently, then releases shared resources once and exits successfully", async () => {
  const first = gate(), second = gate(), calls: string[] = [], terminate = vi.fn();
  const shutdown = createRuntimeShutdown({ drain: [
    { name: "web", close() { calls.push("web"); return first.promise; } },
    { name: "worker", close() { calls.push("worker"); return second.promise; } },
  ], release: [{ name: "database", close() { calls.push("database"); } }], terminate });
  const closing = shutdown.close(); expect(shutdown.close()).toBe(closing); expect(shutdown.closing).toBe(true);
  await Promise.resolve(); expect(calls).toEqual(["web", "worker"]);
  first.resolve(); await Promise.resolve(); expect(calls).not.toContain("database");
  second.resolve(); expect(await closing).toEqual({ status: "closed", exitCode: 0, failures: 0 });
  expect(calls).toEqual(["web", "worker", "database"]); expect(terminate).toHaveBeenCalledTimes(1);
});

it("terminates a hung drain at the overall deadline and ignores its late completion", async () => {
  vi.useFakeTimers(); const pending = gate(), release = vi.fn(), terminate = vi.fn();
  const shutdown = createRuntimeShutdown({ drain: [{ name: "relay", close: () => pending.promise }], release: [{ name: "database", close: release }], deadlineMs: 30, terminate });
  const closing = shutdown.close(); await vi.advanceTimersByTimeAsync(31);
  expect(terminate).toHaveBeenCalledTimes(1); expect(terminate.mock.calls[0]?.[0]).toBe(1);
  expect(await closing).toEqual({ status: "deadline", exitCode: 1, failures: 0 });
  expect(shutdown.close()).toBe(closing); pending.resolve(); await vi.advanceTimersByTimeAsync(100);
  expect(release).not.toHaveBeenCalled(); expect(terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it("absorbs late rejection after deadline without a second terminal action", async () => {
  vi.useFakeTimers(); let reject!: (cause: Error) => void; const terminate = vi.fn(), observed = vi.fn();
  const shutdown = createRuntimeShutdown({ drain: [{ name: "worker", close: () => new Promise<void>((_resolve, fail) => { reject = fail; }) }], release: [], deadlineMs: 10, terminate, onError: observed });
  const closing = shutdown.close(); await vi.advanceTimersByTimeAsync(11); await closing;
  reject(new Error("Late database failure")); await vi.advanceTimersByTimeAsync(1);
  expect(terminate).toHaveBeenCalledTimes(1); expect(observed).toHaveBeenCalledTimes(1);
});

it("attempts all drains and releases after failures without letting a logging observer reject shutdown", async () => {
  const calls: string[] = [], terminate = vi.fn(), onError = vi.fn(() => { throw new Error("Logger unavailable"); });
  const shutdown = createRuntimeShutdown({ drain: [
    { name: "broken", close() { calls.push("broken"); throw new Error("Database unavailable"); } },
    { name: "socket", close() { calls.push("socket"); } },
  ], release: [{ name: "database", async close() { calls.push("database"); throw new Error("Release unavailable"); } }], terminate, onError });
  expect(await shutdown.close()).toEqual({ status: "failed", exitCode: 1, failures: 2 });
  expect(calls).toEqual(["broken", "socket", "database"]); expect(onError).toHaveBeenCalledTimes(2); expect(terminate).toHaveBeenCalledTimes(1);
});

it("shares one deadline across producer drain and resource release", async () => {
  vi.useFakeTimers(); const first = gate(), release = vi.fn(() => new Promise<void>(() => undefined)), terminate = vi.fn();
  const shutdown = createRuntimeShutdown({ drain: [{ name: "worker", close: () => first.promise }], release: [{ name: "database", close: release }], deadlineMs: 30, terminate });
  const closing = shutdown.close(); await vi.advanceTimersByTimeAsync(20); first.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(release).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(11);
  expect(await closing).toMatchObject({ status: "deadline", exitCode: 1 }); expect(terminate).toHaveBeenCalledTimes(1);
});

it("keeps the deadline alive and really terminates a process whose operation never settles", async () => {
  const module = new URL("../src/server/runtime-shutdown.ts", import.meta.url).href;
  const source = `import { createRuntimeShutdown } from ${JSON.stringify(module)};
    createRuntimeShutdown({drain:[{name:'hung',close:()=>new Promise(()=>{})}],release:[],deadlineMs:40,terminate:code=>process.exit(code)}).close();`;
  await expect(execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { timeout: 3000 })).rejects.toMatchObject({ code: 1, killed: false });
});

it("quiesces the real background poll before a hung drain reaches its deadline", async () => {
  vi.useFakeTimers(); const pending = gate(), operation = vi.fn(() => pending.promise), terminate = vi.fn();
  const poll = startBackgroundPoll(operation, 10, vi.fn(), { immediate: true });
  await vi.advanceTimersByTimeAsync(0); expect(operation).toHaveBeenCalledTimes(1);
  const shutdown = createRuntimeShutdown({ drain: [{ name: "relay", close: () => poll.close() }], release: [], deadlineMs: 30, terminate });
  const closing = shutdown.close(); await vi.advanceTimersByTimeAsync(1);
  expect(poll.runtimeStats().closed).toBe(true); poll.trigger();
  await vi.advanceTimersByTimeAsync(30); expect(await closing).toMatchObject({ status: "deadline", exitCode: 1 });
  pending.resolve(); await vi.advanceTimersByTimeAsync(100);
  expect(operation).toHaveBeenCalledTimes(1); expect(terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it("rejects an unbounded or already expired shutdown budget", () => {
  for (const deadlineMs of [0, -1, Number.POSITIVE_INFINITY, Number.NaN, 120_001])
    expect(() => createRuntimeShutdown({ drain: [], release: [], deadlineMs, terminate: vi.fn() })).toThrow("Invalid shutdown deadline");
});
