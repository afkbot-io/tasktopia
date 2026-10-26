import { expect, it } from 'vitest';
import { matchesRealtimeScope } from '../src/client/realtime-scope';

it('rejects the previous country before its old listener cleanup and fences delayed cursor/snapshot writes', async () => {
  let authority = 'A', epoch = 1, cursor = 20, snapshot = 'A', writes = 0;
  const valid = () => matchesRealtimeScope('A', 1, authority, epoch);
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const lateSnapshot = pending.then(() => { if (valid()) { snapshot = 'A'; cursor = 100; writes++; } });
  expect({ cursor, snapshot }).toEqual({ cursor: 20, snapshot: 'A' });
  authority = 'B'; snapshot = 'B'; cursor = 30;
  // Listener still exists, but applyBootstrap has already changed authority.
  if (valid()) { cursor = 200; snapshot = 'A'; writes++; }
  release(); await lateSnapshot;
  expect({ cursor, snapshot, writes }).toEqual({ cursor: 30, snapshot: 'B', writes: 0 });
  epoch = 2; authority = 'A'; expect(valid()).toBe(false);
  expect(matchesRealtimeScope('A', 2, authority, epoch)).toBe(true);
  expect(matchesRealtimeScope(undefined, 2, undefined, epoch)).toBe(false);
});
