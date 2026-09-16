/** Server epoch advanced by the browser's monotonic clock. Civil clock changes
 * cannot restart a trip. Later network samples slew gently, never run backwards. */
export class ServerWorldClock {
  private value: number | undefined;
  private last = 0;
  private targetOffset = 0;
  synchronize(serverMs: number, sentAt: number, receivedAt: number): boolean {
    const rtt = receivedAt - sentAt;
    if (!Number.isFinite(serverMs) || serverMs < 1_000_000_000_000 || !Number.isFinite(rtt) || rtt < 0 || rtt > 5000) return false;
    const estimate = serverMs + rtt / 2;
    if (this.value === undefined) { this.value = estimate; this.last = receivedAt; }
    else this.now(receivedAt);
    this.targetOffset = estimate - receivedAt;
    return true;
  }
  now(monotonicMs: number): number | null {
    if (this.value === undefined) return null;
    const elapsed = Math.max(0, monotonicMs - this.last);
    const natural = this.value + elapsed;
    const correction = Math.max(-elapsed * .1, Math.min(elapsed * .1, monotonicMs + this.targetOffset - natural));
    this.value = natural + correction;
    this.last = Math.max(this.last, monotonicMs);
    return this.value;
  }
}
const clock = new ServerWorldClock();
export function synchronizeWorldClock(headers: Headers, sentAt: number, receivedAt: number) {
  const timestamp = headers.get("x-tasktopia-server-time");
  if (timestamp !== null && /(?:^|,)\s*no-store\s*(?:,|$)/i.test(headers.get("cache-control") ?? "") && Number(headers.get("age") ?? 0) === 0) clock.synchronize(Number(timestamp),sentAt,receivedAt);
}
export const readServerWorldTime = () => clock.now(performance.now());
