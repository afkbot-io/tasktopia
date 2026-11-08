import { createCityMobility } from '../../src/client/city-mobility';
import { createEverydayController } from '../../src/client/city-everyday-controller';
import type { Cell, RoadCellDto } from '../../src/shared/contracts';

export function cityTransitGrid(walkerLimit = 16) {
  const roads = new Map<string, RoadCellDto>(), walk = new Map<string, Cell>(), ground = new Map<string, Cell>();
  for (const axis of [0, 20, 40]) for (let s = -1; s <= 41; s++) for (const b of [-1, 0, 1])
    for (const c of [{ x: s, y: axis + b }, { x: axis + b, y: s }]) roads.set(`${c.x},${c.y}`, { ...c, roadClass: 'LOCAL' } as RoadCellDto);
  for (let y = -5; y <= 45; y++) for (let x = -5; x <= 45; x++) if (!roads.has(`${x},${y}`)) ground.set(`${x},${y}`, { x, y });
  for (const road of roads.values()) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    if (Math.abs(x) + Math.abs(y) > 2) continue;
    const id = `${road.x + x},${road.y + y}`, cell = ground.get(id); if (cell) walk.set(id, cell);
  }
  const input = { roads, walkGraph: walk, crosswalks: new Set<string>(), activityCells: new Set<string>(), seed: 37,
    carLimit: 8, walkerLimit, transitFleet: true };
  const city = createCityMobility(input), controller = createEverydayController('city', () => city, () => undefined);
  const lifeInput = { tasks: [], roads, walk, ground, blocked: new Set<string>(), decorations: [] };
  controller.compile(lifeInput);
  return { city, controller, input, lifeInput, view: { minX: -10, minY: -10, maxX: 70, maxY: 70 },
    options: { enabled: true, economy: false, busy: new Set<string>(), roadBusy: false } };
}
