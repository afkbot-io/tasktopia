import { expect, it } from "vitest";
import { compileBlockLayout, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import type { PortSitePlan } from "../src/shared/port-site";
const input: BlockLayoutCompilerInput = {
  countryId: "country", cityId: "city", seed: 42, revision: 1,
  districts: [{ id: "district", archetype: "MIXED_URBAN", sequence: 0, tasks: [{
    id: "port", taskNumber: 1, buildingFamily: "compact-port-v1", requestedFamily: "compact-port-v1",
    facadeVariant: "south", constructionStage: 1,
  }] }],
};
const allocate: NonNullable<BlockLayoutCompilerInput["planPort"]> = terminal => ({
  terminal, approach: [{ x: terminal.maxX + 1, y: terminal.minY + 1 }],
  pier: [2, 3, 4].map(offset => ({ x: terminal.maxX + offset, y: terminal.minY + 1 })),
  berth: { x: terminal.maxX + 4, y: terminal.minY + 3 },
  waterPath: [{ x: terminal.maxX + 4, y: terminal.minY + 3 }],
  link: { countryId: "country", cityId: "city", worldSeed: 42, localOutlet: { x: terminal.maxX + 4, y: terminal.minY + 3 }, oceanOutlet: { x: 10, y: 10 } },
});
it("requires a validated allocator and persists only local geometry of a unique port", () => {
  expect(() => compileBlockLayout(input)).toThrow(/морского порта/);
  expect(() => compileBlockLayout({ ...input, planPort: () => null })).toThrow(/морского порта/);
  const result = compileBlockLayout({ ...input, planPort: allocate });
  const placement = result.placements[0]!;
  expect(placement).toMatchObject({ serviceRole: "PORT", buildingFamily: "compact-port-v1" });
  const plans = result.blocks.find(b => b.id === placement.blockId)!.parameters.slotPortPlans as Record<string, Omit<PortSitePlan, "link">>;
  expect(plans[placement.slotKey]).toHaveProperty("pier");
  expect(plans[placement.slotKey]).not.toHaveProperty("link");
  expect(JSON.stringify(plans)).not.toContain("oceanOutlet");
  const updated = compileBlockLayout({ ...input, revision: 2, previous: result,
    districts: [{ ...input.districts[0]!, tasks: [{ ...input.districts[0]!.tasks[0]!, constructionStage: 5 }] }] });
  expect(updated.blocks[0]!.parameters.slotPortPlans).toEqual(result.blocks[0]!.parameters.slotPortPlans);
  expect(updated.placements[0]!.constructionStage).toBe(5);
});
it("rejects an allocator result for another country and a second port", () => {
  expect(() => compileBlockLayout({ ...input, planPort: terminal => {
    const plan = allocate(terminal, [])!;
    return { ...plan, link: { ...plan.link, countryId: "foreign" } };
  } })).toThrow(/морского порта/);
  expect(() => compileBlockLayout({ ...input, planPort: allocate,
    districts: [{ ...input.districts[0]!, tasks: [input.districts[0]!.tasks[0]!, { ...input.districts[0]!.tasks[0]!, id: "second", taskNumber: 2 }] }] })).toThrow(/порт/);
});

it("reserves a persisted port approach against later blocks and their perimeter roads", () => {
  const first = compileBlockLayout({ ...input, planPort: allocate });
  const block = first.blocks[0]!;
  const plans = block.parameters.slotPortPlans as Record<string, Omit<PortSitePlan, "link">>;
  const plan = plans[first.placements[0]!.slotKey]!;
  // A previously validated approach outside the eastern block perimeter.
  plan.approach = Array.from({ length: 64 }, (_, i) => ({ x: block.origin.x + block.width + i, y: block.origin.y + 8 }));
  const grown = compileBlockLayout({ ...input, revision: 2, previous: first,
    districts: [{ ...input.districts[0]!, tasks: [input.districts[0]!.tasks[0]!, ...Array.from({ length: 36 }, (_, i) => ({
      id: `home-${i}`, taskNumber: i + 2, buildingFamily: "residential", facadeVariant: "south", constructionStage: 1 as const,
    }))] }] });
  expect(grown.blocks.length).toBeGreaterThan(1);
  for (const other of grown.blocks.filter(b => b.id !== block.id)) {
    expect(plan.approach.some(cell => cell.x >= other.origin.x - 2 && cell.x <= other.origin.x + other.width + 1
      && cell.y >= other.origin.y - 2 && cell.y <= other.origin.y + other.height + 1)).toBe(false);
  }
});

it("automatically uses one eligible new parcel after six occupied blocks without blocking inland homes",()=>{
  const tasks=Array.from({length:140},(_,i)=>({id:`task-${i}`,taskNumber:i+1,buildingFamily:"residential",facadeVariant:"south",constructionStage:1 as const}));
  const base={...input,districts:[{...input.districts[0]!,tasks}]};
  const coastal=compileBlockLayout({...base,planPort:allocate});
  const ports=coastal.placements.filter(p=>p.serviceRole==="PORT");
  expect(ports).toHaveLength(1);
  const index=coastal.placements.findIndex(p=>p.taskId===ports[0]!.taskId);
  expect(new Set(coastal.placements.slice(0,index).map(p=>p.blockId)).size).toBeGreaterThanOrEqual(6);
  const inland=compileBlockLayout({...base,planPort:()=>null});
  expect(inland.placements).toHaveLength(tasks.length);
  expect(inland.placements.some(p=>p.serviceRole==="PORT")).toBe(false);
});
