import { describe, expect, it } from "vitest";
import { compileBlockLayout, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import { CITY_LANDMARKS, cityLandmarkCandidates, isCityLandmark } from "../src/shared/city-landmarks";
import { BUILDING_CATALOG } from "../src/shared/catalog";

const mall = "compact-city-mall-v1";
const input = (count: number): BlockLayoutCompilerInput => ({
  countryId: "country", cityId: "city", seed: 7, revision: 1,
  districts: [{ id: "district", sequence: 0, archetype: "MIXED_URBAN",
    tasks: Array.from({ length: count }, (_, i) => ({
      id: `task-${i + 1}`, taskNumber: i + 1, buildingFamily: "compact-apartment-v1",
      facadeVariant: "south", constructionStage: 5, visualKind: "BUILDING",
    })) }],
});

describe("городские уникальные здания", () => {
  it("описывает20 разных типов без жилых домов", () => {
    expect(CITY_LANDMARKS).toHaveLength(20);
    expect(new Set(CITY_LANDMARKS.map(item => item.family)).size).toBe(20);
    expect(CITY_LANDMARKS.some(item => item.family === "compact-four-floor-house-v1")).toBe(false);
    for (const item of CITY_LANDMARKS) {
      const building = BUILDING_CATALOG.find(entry => entry.key === item.family)!;
      expect(building, item.family).toBeDefined();
      expect(cityLandmarkCandidates(building.footprint.width, building.footprint.height)).toContain(item.family);
    }
  });

  it("выдаёт готовый торговый центр один раз и сохраняет его при росте", () => {
    const spec = input(180);
    const first = compileBlockLayout(spec);
    const landmarks = first.placements.filter(p => isCityLandmark(p.buildingFamily));
    expect(landmarks.length).toBeGreaterThan(1);
    expect(new Set(landmarks.map(p => p.buildingFamily)).size).toBe(landmarks.length);
    expect(landmarks[0]!.serviceRole).toBeUndefined();
    const next = compileBlockLayout({ ...input(220), previous: first, revision: 2 });
    for (const landmark of landmarks) expect(next.placements.find(p => p.taskId === landmark.taskId)).toEqual(landmark);
    expect(compileBlockLayout({ ...spec, districts: spec.districts.map(d => ({ ...d, tasks: [...d.tasks].reverse() })) })).toEqual(first);
    const homes = first.placements.filter(p => BUILDING_CATALOG.find(entry => entry.key === p.buildingFamily)?.category === "HOUSE");
    expect(homes.length).toBeGreaterThan(new Set(homes.map(p => p.buildingFamily)).size);
  });

  it("запрещает повторный явный выбор уникального семейства", () => {
    const spec = input(2);
    spec.districts[0]!.tasks.forEach(t => { t.requestedFamily = mall; });
    expect(() => compileBlockLayout(spec)).toThrow(/уже.*город/i);
  });

  it("распределяет разные готовые типы по кварталам, не группируя их вместе", () => {
    const layout = compileBlockLayout(input(500));
    const unique = layout.placements.filter(p => isCityLandmark(p.buildingFamily));
    expect(unique.length).toBeGreaterThanOrEqual(10);
    expect(new Set(unique.map(p => p.blockId)).size).toBe(unique.length);
    expect(new Set(unique.map(p => p.buildingFamily)).size).toBe(unique.length);
  });

  it("разные города получают отличающееся, но воспроизводимое место здания", () => {
    const owners = new Set(Array.from({ length: 6 }, (_, i) =>
      compileBlockLayout({ ...input(180), cityId: `city-${i}` }).placements.find(p => isCityLandmark(p.buildingFamily))?.taskId));
    expect(owners.has(undefined)).toBe(false);
    expect(owners.size).toBeGreaterThan(1);
  });

  it("помнит закрытый участок и разрешает перенос тому же владельцу", () => {
    const first = compileBlockLayout(input(180));
    const landmark = first.placements.find(p => isCityLandmark(p.buildingFamily))!;
    const mall = landmark.buildingFamily;
    expect(landmark).toBeDefined();
    first.placements = first.placements.filter(p => p.taskId !== landmark.taskId);
    first.siteMarkers.push({ id: "closed", blockId: landmark.blockId, slotKey: landmark.slotKey,
      kind: "RUINED", assetVariant: "compact-rubble", snapshot: { buildingFamily: mall } });
    const deleted = input(200);
    deleted.districts[0]!.tasks = deleted.districts[0]!.tasks.filter(t => t.id !== landmark.taskId);
    const next = compileBlockLayout({ ...deleted, previous: first, revision: 2 });
    expect(next.placements.some(p => p.buildingFamily === mall)).toBe(false);

    first.siteMarkers[0] = { ...first.siteMarkers[0]!, kind: "RELOCATED", targetTaskId: landmark.taskId };
    const movedTask = input(180).districts[0]!.tasks.find(t => t.id === landmark.taskId)!;
    deleted.districts.push({ id: "destination", sequence: 1, archetype: "MIXED_URBAN",
      tasks: [{ ...movedTask, requestedFamily: mall, serviceRoleAssigned: true }] });
    const moved = compileBlockLayout({ ...deleted, previous: first, revision: 2 });
    expect(moved.placements.filter(p => p.buildingFamily === mall)).toHaveLength(1);
    expect(moved.placements.find(p => p.buildingFamily === mall)!.taskId).toBe(landmark.taskId);
  });
});
