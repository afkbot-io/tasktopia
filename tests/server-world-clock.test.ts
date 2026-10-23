import { expect,it } from "vitest";
import { ServerWorldClock } from "../src/client/server-world-clock";
import { sceneClockStepTowardStart } from "./scene-clock-step";
import type { CityRailway } from "../src/shared/city-railway";
import { cityRailService } from "../src/shared/city-rail-service";
import { transportSchedule } from "../src/shared/transport-schedule";
const epoch = Date.UTC(2026,8,15);
it("anchors the server epoch, ignores invalid or stale network samples and advances through suspension",()=>{
  const clock = new ServerWorldClock();
  expect(clock.now(10)).toBeNull();
  expect(clock.synchronize(epoch,100,200)).toBe(true);
  expect(clock.now(200)).toBe(epoch+50);
  expect(clock.now(300_200)).toBe(epoch+300_050);
  expect(clock.synchronize(epoch,0,9000)).toBe(false);
  expect(clock.synchronize(NaN,0,10)).toBe(false);
  expect(clock.now(300_300)).toBe(epoch+300_150);
});
it("corrects network jitter without reversing time or depending on the device wall clock",()=>{
  const clock = new ServerWorldClock(); clock.synchronize(epoch,0,0);
  clock.synchronize(epoch-500,100,100);
  const before = clock.now(100)!;
  const after = clock.now(1100)!;
  expect(after-before).toBeGreaterThanOrEqual(900);
  expect(after-before).toBeLessThanOrEqual(1100);
  clock.synchronize(epoch+10_000,1200,1200);
  expect(clock.now(2200)!-after).toBeLessThanOrEqual(1210);
});
it("keeps train phase across remounts and independently initialized tabs",()=>{
  const line: CityRailway={stationId:"station",axis:"horizontal",from:{x:0,y:0},to:{x:500,y:0},platform:{x:250,y:0},access:[],stage:5,running:true};
  const connection = {id:transportSchedule("RAIL","station","other").id,fromStationId:"station",toStationId:"other",fromCityId:"a",toCityId:"b"};
  const sample=(clock:ServerWorldClock, time:number)=>cityRailService(line,[connection],clock.now(time)!);
  const a=new ServerWorldClock(), b=new ServerWorldClock();
  a.synchronize(epoch,0,100); b.synchronize(epoch,9000,9100);
  expect(sample(a,1100))
    .toEqual(sample(b,10100));
  const resumed = new ServerWorldClock(); resumed.synchronize(epoch+300_000,0,100);
  expect(sample(a,300_100))
    .toEqual(sample(resumed,100));
});

// The recorded road case uses server time but fastForward advances a monotonic
// browser clock. No private clock value, app actor, route or timer is replaced.
function fourRoadClockSamples(initial: number, correction: number) {
  const clock = new ServerWorldClock();
  expect(clock.synchronize(initial, 0, 0)).toBe(true);
  expect(clock.synchronize(initial + correction, 0, 0)).toBe(true);
  let monotonic = 0, now = clock.now(0)!;
  const samples: Array<{ before: number; target: number; step: number; after: number; inside: boolean }> = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const target = (Math.floor(now / 90_000) + (now % 90_000 < 12_000 ? 0 : 1)) * 90_000 + 12_000;
    const step = sceneClockStepTowardStart(now, target);
    monotonic += step + 100; // Same existing runFor(100), not extra physics.
    const after = clock.now(monotonic)!;
    samples.push({ before: now, target, step, after, inside: after >= target && after < target + 4000 });
    now = after;
    if (samples.at(-1)!.inside) break;
  }
  return samples;
}
it('the road clock arrangement reaches admission within the original four advances under intended positive slew', () => {
  // This retained CI serverNow is real. The valid public resync is a bounded
  // counterexample precondition, not a claim about the missing CI targetOffset.
  const samples = fourRoadClockSamples(1792780787974.43, 90_000);
  expect(samples.some(sample => sample.inside), JSON.stringify(samples)).toBe(true);
});
it('the conservative road clock arrangement covers both slew limits and the longest next-window gap', () => {
  const target = Math.floor(epoch / 90_000) * 90_000 + 102_000;
  for (const gap of [1, 1000, 54_025.57, 90_000]) for (const correction of [-90_000, 0, 90_000]) {
    const samples = fourRoadClockSamples(target - gap, correction);
    expect(samples.every(sample => sample.after < sample.target + 4000), JSON.stringify(samples)).toBe(true);
    expect(samples.some(sample => sample.inside), JSON.stringify(samples)).toBe(true);
  }
});
