import type { CitySceneDto } from '../../src/shared/city-scene-contract';
import { materializeChunkPayload } from '../../src/shared/world-chunk-payload';
import { buildCityWalkNetwork } from '../../src/client/city-walk-network';
const key = (cell: { x: number; y: number }) => `${cell.x},${cell.y}`;
export function sceneWalkGeometry(scene: CitySceneDto) {
  const chunks = scene.chunks.map(chunk => materializeChunkPayload(chunk));
  const tasks = [...new Map([...chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task])).values()];
  const roads = new Map(chunks.flatMap(chunk => chunk.roads).map(cell => [key(cell), cell]));
  const surfaces = chunks.flatMap(chunk => chunk.surfaces);
  return { tasks, roads, surfaces, ...buildCityWalkNetwork({ tasks, roads, surfaces, terrain: chunks.flatMap(chunk => chunk.terrain),
    features: chunks.flatMap(chunk => chunk.worldFeatures), decorations: chunks.flatMap(chunk => chunk.decorations) }) };
}
