import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Cell = { x: number; y: number };
type Size = { width: number; height: number };
type Layout = {
  name: AlgorithmName;
  cells: Set<string>;
  roads: Set<string>;
};
type AlgorithmName = "rectangle" | "polyomino" | "hybrid";
type RunMetrics = {
  compactness: number;
  accessibleRatio: number;
  lotAreaUtilization: number;
  lotSuccessRatio: number;
  tendrilRatio: number;
  roadRatio: number;
};
type Aggregate = RunMetrics & {
  algorithm: AlgorithmName;
  runs: number;
  uniqueFingerprintRatio: number;
};

const STUDY_RUNS = 300;
const TARGET_CELLS = 108;
const LOTS: Size[] = [
  { width: 4, height: 3 },
  { width: 3, height: 3 },
  { width: 3, height: 2 },
  { width: 3, height: 2 },
  { width: 2, height: 2 },
  { width: 2, height: 2 },
  { width: 2, height: 2 },
  { width: 2, height: 2 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function parseKey(value: string): Cell {
  const [x, y] = value.split(",").map(Number);
  if (x === undefined || y === undefined) throw new Error(`Invalid cell: ${value}`);
  return { x, y };
}

function neighbors4(cell: Cell): Cell[] {
  return [
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x - 1, y: cell.y },
  ];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rectangle(seed: number): Layout {
  const random = mulberry32(seed);
  const width = 9 + Math.floor(random() * 4);
  const height = Math.ceil(TARGET_CELLS / width);
  const cells = new Set<string>();
  const roads = new Set<string>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) cells.add(key(x, y));
  }
  const roadY = Math.floor(height / 2);
  for (let x = 0; x < width; x += 1) roads.add(key(x, roadY));
  return { name: "rectangle", cells, roads };
}

function frontierOf(cells: Set<string>): Cell[] {
  const frontier = new Map<string, Cell>();
  for (const value of cells) {
    for (const candidate of neighbors4(parseKey(value))) {
      const candidateKey = key(candidate.x, candidate.y);
      if (!cells.has(candidateKey)) frontier.set(candidateKey, candidate);
    }
  }
  return [...frontier.values()];
}

function polyomino(seed: number): Layout {
  const random = mulberry32(seed);
  const cells = new Set<string>([key(0, 0)]);
  while (cells.size < TARGET_CELLS) {
    const frontier = frontierOf(cells);
    const weighted = frontier.map((cell) => {
      const adjacent = neighbors4(cell).filter((neighbor) => cells.has(key(neighbor.x, neighbor.y))).length;
      return { cell, score: random() + adjacent * 0.08 };
    });
    weighted.sort((a, b) => b.score - a.score);
    const window = Math.min(8, weighted.length);
    const selected = weighted[Math.floor(random() * window)];
    if (!selected) throw new Error("Polyomino frontier exhausted");
    cells.add(key(selected.cell.x, selected.cell.y));
  }

  const bounds = getBounds(cells);
  const start = nearestCell(cells, { x: bounds.minX, y: Math.floor((bounds.minY + bounds.maxY) / 2) });
  const end = nearestCell(cells, { x: bounds.maxX, y: Math.floor((bounds.minY + bounds.maxY) / 2) });
  const roads = shortestPath(cells, start, end, seed ^ 0xa5a5a5a5);
  return { name: "polyomino", cells, roads };
}

function hybrid(seed: number): Layout {
  const random = mulberry32(seed);
  const roads = new Set<string>();
  const variant = seed % 3;
  const width = 12 + (seed % 2);
  const height = 10 + ((seed >>> 1) % 2);
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  for (let x = 0; x < width; x += 1) roads.add(key(x, midY));
  if (variant === 0 || variant === 1) {
    const endY = variant === 0 ? height - 1 : midY;
    for (let y = 0; y <= endY; y += 1) roads.add(key(midX, y));
  } else {
    for (let y = 2; y < height - 1; y += 1) {
      roads.add(key(3, y));
      roads.add(key(width - 4, y));
    }
    for (let x = 3; x <= width - 4; x += 1) {
      roads.add(key(x, 2));
      roads.add(key(x, height - 2));
    }
  }

  const cells = new Set<string>(roads);
  while (cells.size < TARGET_CELLS) {
    const candidates = frontierOf(cells).filter((cell) =>
      cell.x >= -1 && cell.x <= width && cell.y >= -1 && cell.y <= height,
    );
    const scored = candidates.map((cell) => {
      const adjacency = neighbors4(cell).filter((neighbor) => cells.has(key(neighbor.x, neighbor.y))).length;
      const roadDistance = minManhattan(cell, roads);
      const borderPenalty = cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height ? 0.35 : 0;
      return {
        cell,
        score: adjacency * 0.6 - roadDistance * 0.08 - borderPenalty + random() * 0.8,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const selected = scored[Math.floor(random() * Math.min(5, scored.length))];
    if (!selected) throw new Error("Hybrid frontier exhausted");
    cells.add(key(selected.cell.x, selected.cell.y));
  }
  for (const road of [...roads]) if (!cells.has(road)) roads.delete(road);
  return { name: "hybrid", cells, roads };
}

function shortestPath(cells: Set<string>, start: Cell, end: Cell, seed: number): Set<string> {
  const queue: Cell[] = [start];
  const previous = new Map<string, string>();
  const visited = new Set<string>([key(start.x, start.y)]);
  const random = mulberry32(seed);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.x === end.x && current.y === end.y) break;
    const next = neighbors4(current)
      .filter((neighbor) => cells.has(key(neighbor.x, neighbor.y)))
      .map((neighbor) => ({ neighbor, score: Math.abs(end.x - neighbor.x) + Math.abs(end.y - neighbor.y) + random() * 0.3 }))
      .sort((a, b) => a.score - b.score);
    for (const { neighbor } of next) {
      const nextKey = key(neighbor.x, neighbor.y);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      previous.set(nextKey, key(current.x, current.y));
      queue.push(neighbor);
    }
  }
  const path = new Set<string>();
  let cursor = key(end.x, end.y);
  path.add(cursor);
  while (cursor !== key(start.x, start.y)) {
    const next = previous.get(cursor);
    if (!next) break;
    cursor = next;
    path.add(cursor);
  }
  return path;
}

function nearestCell(cells: Set<string>, target: Cell): Cell {
  let best: Cell | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const value of cells) {
    const cell = parseKey(value);
    const distance = Math.abs(cell.x - target.x) + Math.abs(cell.y - target.y);
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  if (!best) throw new Error("Empty layout");
  return best;
}

function minManhattan(cell: Cell, targets: Set<string>): number {
  let best = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const parsed = parseKey(target);
    best = Math.min(best, Math.abs(cell.x - parsed.x) + Math.abs(cell.y - parsed.y));
  }
  return best;
}

function getBounds(cells: Set<string>): { minX: number; maxX: number; minY: number; maxY: number } {
  const parsed = [...cells].map(parseKey);
  return {
    minX: Math.min(...parsed.map((cell) => cell.x)),
    maxX: Math.max(...parsed.map((cell) => cell.x)),
    minY: Math.min(...parsed.map((cell) => cell.y)),
    maxY: Math.max(...parsed.map((cell) => cell.y)),
  };
}

function placeLots(layout: Layout, seed: number): { placed: number; usedArea: number } {
  const random = mulberry32(seed);
  const occupied = new Set(layout.roads);
  let placed = 0;
  let usedArea = 0;
  for (const lot of LOTS) {
    const rotations = lot.width === lot.height ? [lot] : [lot, { width: lot.height, height: lot.width }];
    const candidates: string[][] = [];
    const bounds = getBounds(layout.cells);
    for (const size of rotations) {
      for (let y = bounds.minY; y <= bounds.maxY - size.height + 1; y += 1) {
        for (let x = bounds.minX; x <= bounds.maxX - size.width + 1; x += 1) {
          const footprint: string[] = [];
          let valid = true;
          for (let dy = 0; dy < size.height; dy += 1) {
            for (let dx = 0; dx < size.width; dx += 1) {
              const value = key(x + dx, y + dy);
              if (!layout.cells.has(value) || occupied.has(value)) valid = false;
              footprint.push(value);
            }
          }
          const accessible = footprint.some((value) => minManhattan(parseKey(value), layout.roads) <= 2);
          if (valid && accessible) candidates.push(footprint);
        }
      }
    }
    if (candidates.length === 0) continue;
    const selected = candidates[Math.floor(random() * candidates.length)];
    if (!selected) continue;
    for (const value of selected) occupied.add(value);
    placed += 1;
    usedArea += selected.length;
  }
  return { placed, usedArea };
}

function measure(layout: Layout, seed: number): RunMetrics {
  const bounds = getBounds(layout.cells);
  const boundingArea = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
  const buildable = [...layout.cells].filter((value) => !layout.roads.has(value));
  const accessible = buildable.filter((value) => minManhattan(parseKey(value), layout.roads) <= 2).length;
  const tendrils = [...layout.cells].filter((value) => {
    const cell = parseKey(value);
    return neighbors4(cell).filter((neighbor) => layout.cells.has(key(neighbor.x, neighbor.y))).length <= 1;
  }).length;
  const lotResult = placeLots(layout, seed ^ 0x6f6f6f6f);
  return {
    compactness: layout.cells.size / boundingArea,
    accessibleRatio: buildable.length === 0 ? 0 : accessible / buildable.length,
    lotAreaUtilization: buildable.length === 0 ? 0 : lotResult.usedArea / buildable.length,
    lotSuccessRatio: lotResult.placed / LOTS.length,
    tendrilRatio: tendrils / layout.cells.size,
    roadRatio: layout.roads.size / layout.cells.size,
  };
}

function fingerprint(layout: Layout): string {
  const bounds = getBounds(layout.cells);
  const values: string[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const value = key(x, y);
      values.push(layout.roads.has(value) ? "R" : layout.cells.has(value) ? "D" : ".");
    }
    values.push("/");
  }
  return values.join("");
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregate(name: AlgorithmName, layouts: Layout[], metrics: RunMetrics[]): Aggregate {
  return {
    algorithm: name,
    runs: metrics.length,
    compactness: average(metrics.map((metric) => metric.compactness)),
    accessibleRatio: average(metrics.map((metric) => metric.accessibleRatio)),
    lotAreaUtilization: average(metrics.map((metric) => metric.lotAreaUtilization)),
    lotSuccessRatio: average(metrics.map((metric) => metric.lotSuccessRatio)),
    tendrilRatio: average(metrics.map((metric) => metric.tendrilRatio)),
    roadRatio: average(metrics.map((metric) => metric.roadRatio)),
    uniqueFingerprintRatio: new Set(layouts.map(fingerprint)).size / layouts.length,
  };
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderSvg(layouts: Layout[]): string {
  const scale = 12;
  const panelWidth = 260;
  const panelHeight = 220;
  const labels: Record<AlgorithmName, string> = {
    rectangle: "A. Rectangle + straight road",
    polyomino: "B. Free polyomino + path",
    hybrid: "C. Road-first + reserved lots",
  };
  const panels = layouts.map((layout, index) => {
    const bounds = getBounds(layout.cells);
    const contentWidth = (bounds.maxX - bounds.minX + 1) * scale;
    const contentHeight = (bounds.maxY - bounds.minY + 1) * scale;
    const offsetX = index * panelWidth + (panelWidth - contentWidth) / 2;
    const offsetY = 48 + (panelHeight - 60 - contentHeight) / 2;
    const cells = [...layout.cells].map((value) => {
      const cell = parseKey(value);
      const x = offsetX + (cell.x - bounds.minX) * scale;
      const y = offsetY + (cell.y - bounds.minY) * scale;
      const fill = layout.roads.has(value) ? "#525d70" : "#78a354";
      return `<rect x="${x}" y="${y}" width="${scale}" height="${scale}" fill="${fill}" stroke="#24313a" stroke-width="1"/>`;
    }).join("");
    return `<g><text x="${index * panelWidth + panelWidth / 2}" y="26" text-anchor="middle" fill="#eef4e8" font-family="monospace" font-size="13">${labels[layout.name]}</text>${cells}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * layouts.length}" height="${panelHeight}" viewBox="0 0 ${panelWidth * layouts.length} ${panelHeight}"><rect width="100%" height="100%" fill="#152027"/>${panels}<g transform="translate(16 202)"><rect width="10" height="10" fill="#78a354"/><text x="15" y="9" fill="#cbd8ca" font-family="monospace" font-size="11">district</text><rect x="90" width="10" height="10" fill="#525d70"/><text x="105" y="9" fill="#cbd8ca" font-family="monospace" font-size="11">road</text></g></svg>`;
}

async function main(): Promise<void> {
  const generators: Record<AlgorithmName, (seed: number) => Layout> = { rectangle, polyomino, hybrid };
  const results: Aggregate[] = [];
  for (const name of Object.keys(generators) as AlgorithmName[]) {
    const layouts: Layout[] = [];
    const metrics: RunMetrics[] = [];
    for (let seed = 1; seed <= STUDY_RUNS; seed += 1) {
      const layout = generators[name](seed * 2654435761);
      layouts.push(layout);
      metrics.push(measure(layout, seed));
    }
    results.push(aggregate(name, layouts, metrics));
  }

  const outputDir = path.resolve("screenshots/worldgen-algorithm-study");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "district-algorithm-results.json"), `${JSON.stringify({ runs: STUDY_RUNS, targetCells: TARGET_CELLS, lots: LOTS, results }, null, 2)}\n`);
  await writeFile(path.join(outputDir, "district-algorithm-samples.svg"), renderSvg([rectangle(17), polyomino(17), hybrid(17)]));

  const rows = results.map((result) =>
    `| ${result.algorithm} | ${percentage(result.compactness)} | ${percentage(result.accessibleRatio)} | ${percentage(result.lotSuccessRatio)} | ${percentage(result.lotAreaUtilization)} | ${percentage(result.tendrilRatio)} | ${percentage(result.roadRatio)} | ${percentage(result.uniqueFingerprintRatio)} |`,
  ).join("\n");
  const report = `# Эксперимент планировщиков района\n\n` +
    `Дата: 2026-08-02. Прогон: ${STUDY_RUNS} seed на алгоритм, целевая площадь ${TARGET_CELLS} клеток.\n\n` +
    `| Алгоритм | Compactness | Земля ≤2 от дороги | Успех участков | Занято участками | Tendrils | Доля дорог | Уникальные планы |\n` +
    `|---|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `## Интерпретация\n\n` +
    `- Rectangle — контрольный вариант: высокая компактность, но мало форм и слабая уличная структура.\n` +
    `- Free polyomino даёт максимальную вариативность, но чаще образует неудобные края и хуже упаковывает прямоугольные footprints.\n` +
    `- Hybrid заранее инвестирует часть клеток в разветвлённую дорогу, поэтому его нужно оценивать по доступности и успешности участков, а не только по чистой площади.\n` +
    `- Эксперимент не моделирует реальную воду, city envelope и конкурентные jobs. Перед production нужны property-тесты из qa.md.\n`;
  await writeFile(path.join(outputDir, "district-algorithm-report.md"), report);
  process.stdout.write(`${report}\nArtifacts: ${outputDir}\n`);
}

await main();
