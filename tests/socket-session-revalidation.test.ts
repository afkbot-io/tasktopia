import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSocketSessionRevalidation, type SessionSocket } from "../src/server/socket-session-revalidation";

type User = { id: string; countryId: string };
function fixtureSocket() {
  let onDisconnect: (() => void) | undefined;
  const socket = {
    connected: true as boolean, data: { user: { id: "owner", countryId: "before" }, sessionToken: "private-fixture" },
    join: vi.fn().mockResolvedValue(undefined), leave: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn<(close?: boolean) => void>(() => { socket.connected = false; onDisconnect?.(); }),
    once: vi.fn((_event: string, listener: () => void) => { onDisconnect = listener; }),
    off: vi.fn((_event: string, listener: () => void) => { if (onDisconnect === listener) onDisconnect = undefined; }),
  } satisfies SessionSocket<User>;
  return socket;
}

describe("bounded socket session revalidation", () => {
  let subscription: { close(): Promise<void> } | undefined;
  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => { await subscription?.close(); subscription = undefined; vi.useRealTimers(); });

  it("reports database errors immediately and disconnects an unverifiable session", async () => {
    const socket = fixtureSocket();
    const failure = new Error("session database unavailable");
    const lookup = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    subscription = startSocketSessionRevalidation(socket, lookup, onError, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("never overlaps lookups or applies a late result after disconnect", async () => {
    const socket = fixtureSocket();
    let release!: (user: User) => void;
    const lookup = vi.fn(() => new Promise<User>(resolve => { release = resolve; }));
    subscription = startSocketSessionRevalidation(socket, lookup, vi.fn(), 10);
    await vi.advanceTimersByTimeAsync(60);
    const callsBeforeRelease = lookup.mock.calls.length;
    socket.disconnect(true);
    release({ id: "owner", countryId: "after" });
    await vi.advanceTimersByTimeAsync(0);
    expect(callsBeforeRelease).toBe(1);
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.leave).not.toHaveBeenCalled();
    expect(socket.data.user.countryId).toBe("before");
  });

  it("moves the socket to the verified country and disconnects upon later revocation", async () => {
    const socket = fixtureSocket();
    const lookup = vi.fn().mockResolvedValueOnce({ id: "owner", countryId: "after" }).mockResolvedValue(null);
    subscription = startSocketSessionRevalidation(socket, lookup, vi.fn(), 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(socket.leave).toHaveBeenCalledWith("country:before");
    expect(socket.join).toHaveBeenCalledWith("country:after");
    expect(socket.data.user.countryId).toBe("after");
    await vi.advanceTimersByTimeAsync(10);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects after a bounded session check when the database never responds", async () => {
    const socket = fixtureSocket();
    const lookup = vi.fn(() => new Promise<User | null>(() => undefined));
    const onError = vi.fn();
    subscription = startSocketSessionRevalidation(socket, lookup, onError, 10, 10);
    await vi.advanceTimersByTimeAsync(30);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "SOCKET_SESSION_CHECK_TIMEOUT" }));
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
