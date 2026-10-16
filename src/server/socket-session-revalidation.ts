import { startBackgroundPoll } from "./background-poll";

export async function readSocketSessionWithinDeadline<User>(
  lookup: () => Promise<User | null>, timeoutMs = 10_000,
): Promise<User | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(lookup), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("SOCKET_SESSION_CHECK_TIMEOUT")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export type SessionSocket<User extends { countryId: string }> = {
  connected: boolean;
  data: { user: User; sessionToken?: string };
  join(room: string): void | Promise<unknown>;
  leave(room: string): void | Promise<unknown>;
  disconnect(close?: boolean): unknown;
  once(event: "disconnect", listener: () => void): unknown;
  off(event: "disconnect", listener: () => void): unknown;
};

export function startSocketSessionRevalidation<User extends { countryId: string }>(
  socket: SessionSocket<User>,
  lookup: (token: string | undefined) => Promise<User | null>,
  onError: (error: unknown) => void,
  intervalMs = 60_000,
  checkTimeoutMs = 10_000,
): { close(): Promise<void> } {
  let closed = false;
  const poll = startBackgroundPoll(async () => {
    if (closed || !socket.connected) return;
    const current = await readSocketSessionWithinDeadline(() => lookup(socket.data.sessionToken), checkTimeoutMs);
    if (closed || !socket.connected) return;
    if (!current) { socket.disconnect(true); return; }
    if (socket.data.user.countryId !== current.countryId) {
      await socket.leave(`country:${socket.data.user.countryId}`);
      if (closed || !socket.connected) return;
      await socket.join(`country:${current.countryId}`);
    }
    if (closed || !socket.connected) return;
    socket.data.user = current;
  }, intervalMs, error => {
    // Keep no long-lived socket authorized while its session cannot be checked.
    try { onError(error); } finally { socket.disconnect(true); }
  });
  const close = async () => {
    closed = true;
    socket.off("disconnect", onDisconnect);
    await poll.close();
  };
  const onDisconnect = () => { void close().catch(onError); };
  socket.once("disconnect", onDisconnect);
  return { close };
}
