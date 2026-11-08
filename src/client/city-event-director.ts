import type { Cell } from '../shared/contracts';

export type CityEventChannel = 'ROAD' | 'EVERYDAY' | 'NEIGHBOURHOOD';
export type CityEventRelease = 'COMPLETE' | 'CANCEL' | 'EXPIRED' | 'DISABLED' | 'PROTECTED' | 'PREEMPTED' | 'QUALITY';
export type CityEventLease = { id: string; channel: CityEventChannel; priority: number; cells: readonly Cell[];
  actors: readonly string[]; until: number; replayUntil: number; provisional?: boolean; onRelease: (reason: CityEventRelease) => void };
type OwnedLease = { value: CityEventLease; cells: ReadonlySet<string>; actors: ReadonlySet<string> };
const key = (cell: Cell) => `${cell.x},${cell.y}`;

/** Shared cosmetic ownership only. Actual movement and arrival stay in
 * mobility; real task work protects its cells before any cosmetic admission. */
export class CityEventDirector {
  private leases = new Map<string, OwnedLease>();
  private accepted = new Map<string, number>();
  private attempts = new Map<CityEventChannel, number>();
  private busy: ReadonlySet<string> = new Set();
  private enabled = true;
  private limit = 3;
  private now = 0;
  private pruneAt = 0;
  readonly metrics = { attempts: 0, admitted: 0, conflicts: 0, releases: 0, preempted: 0 };

  update(now: number, options: { enabled: boolean; economy: boolean; busy: ReadonlySet<string> }) {
    this.enabled = options.enabled && Number.isFinite(now);
    this.limit = options.economy ? 2 : 3; this.busy = options.busy;
    if (Number.isFinite(now)) this.now = now;
    if (!this.enabled) { this.clear('DISABLED'); this.attempts.clear(); return; }
    for (const [id, lease] of this.leases) {
      if (now >= lease.value.until) this.release(id, 'EXPIRED');
      else if ([...lease.cells].some(cell => this.busy.has(cell))) this.release(id, 'PROTECTED');
    }
    while (this.leases.size > this.limit) {
      const lowest = [...this.leases.values()].sort((a, b) => a.value.priority - b.value.priority)[0]!;
      this.release(lowest.value.id, 'QUALITY');
    }
    // A capped replay ledger is pruned once per second, never a city scan.
    if (now >= this.pruneAt) {
      this.pruneAt = now + 1000;
      for (const [id, until] of this.accepted) if (now >= until) this.accepted.delete(id);
    }
  }

  due(channel: CityEventChannel, now: number, earliest: number): boolean {
    if (!this.enabled || !Number.isFinite(now) || !Number.isFinite(earliest)
      || [...this.leases.values()].some(lease => lease.value.channel === channel)) return false;
    let next = this.attempts.get(channel);
    if (next === undefined) {
      next = now <= earliest ? earliest : now + 1200;
      this.attempts.set(channel, next);
    }
    next = Math.max(next, earliest);
    if (now < next) return false;
    this.attempts.set(channel, now + 2000); this.metrics.attempts++; return true;
  }

  private evictions(value: CityEventLease): string[] | undefined {
    if (!this.enabled || !value.id || this.accepted.has(value.id) || this.accepted.size >= 512
      || !Number.isFinite(value.until) || value.until <= this.now || !Number.isFinite(value.replayUntil) || value.replayUntil < value.until
      || value.cells.length > 64 || value.actors.length > 8 || value.cells.some(cell => !Number.isFinite(cell.x + cell.y) || this.busy.has(key(cell)))) return;
    const cells = new Set(value.cells.map(key)), actors = new Set(value.actors), evicted: string[] = [];
    for (const [id, lease] of this.leases) {
      if (lease.value.channel === value.channel || [...cells].some(cell => lease.cells.has(cell)) || [...actors].some(actor => lease.actors.has(actor))) {
        if (lease.value.priority >= value.priority) return;
        evicted.push(id);
      }
    }
    if (this.leases.size - evicted.length >= this.limit) {
      const lowest = [...this.leases.values()].filter(lease => !evicted.includes(lease.value.id))
        .sort((a, b) => a.value.priority - b.value.priority)[0]!;
      if (lowest.value.priority >= value.priority) return;
      evicted.push(lowest.value.id);
    }
    return evicted;
  }

  canAcquire(value: CityEventLease): boolean { return this.evictions(value) !== undefined; }

  acquire(value: CityEventLease): boolean {
    const evictions = this.evictions(value);
    if (!evictions) { this.metrics.conflicts++; return false; }
    for (const id of evictions) { this.release(id, 'PREEMPTED'); this.metrics.preempted++; }
    this.leases.set(value.id, { value, cells: new Set(value.cells.map(key)), actors: new Set(value.actors) });
    if (!value.provisional) { this.accepted.set(value.id, value.replayUntil); this.metrics.admitted++; }
    return true;
  }

  claimActors(id: string, actors: readonly string[]): boolean {
    const lease = this.leases.get(id);
    if (!lease || actors.length > 8 || [...this.leases.values()].some(other => other !== lease && actors.some(actor => other.actors.has(actor)))) return false;
    this.leases.set(id, { ...lease, value: { ...lease.value, provisional: false }, actors: new Set(actors) });
    if (lease.value.provisional) { this.accepted.set(id, lease.value.replayUntil); this.metrics.admitted++; }
    return true;
  }

  release(id: string, reason: CityEventRelease = 'CANCEL') {
    const lease = this.leases.get(id); if (!lease) return;
    this.leases.delete(id); this.metrics.releases++;
    lease.value.onRelease(reason);
  }

  clear(reason: CityEventRelease = 'CANCEL') { for (const id of [...this.leases.keys()]) this.release(id, reason); }
  get protectedActorIds(): ReadonlySet<string> { return new Set([...this.leases.values()].flatMap(lease => [...lease.actors])); }
  get active() { return [...this.leases.values()].map(({ value: { id, channel, priority, until } }) => ({ id, channel, priority, until })); }
}
