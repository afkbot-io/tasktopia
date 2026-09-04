import { useEffect, useRef, useState } from "react";
import {
  PROP_SPRITES,
  TERRAIN_SPRITES,
  TILE_SPRITES,
  gameAssetUrl,
  getBuilding,
} from "../../shared/catalog";
import { BLOCK_V1_CITY_PRESENTATION } from "../../shared/city-presentation-profile";

const WIDTH = 1200;
const HEIGHT = 720;
const CELL = BLOCK_V1_CITY_PRESENTATION.logicalCellPx;
const SOURCE_TILE = 8;
const BLOCK_WIDTH = 28 * CELL;
const BLOCK_HEIGHT = 24 * CELL;
const STREET_WIDTH = 5 * CELL;

const BUILDING_KEYS = [
  "shop-cafe",
  "shop-bookstore",
  "shop-electronics",
  "office-small",
  "shop-bakery-long",
  "commercial-corner-cafe",
  "civic-university",
  "commercial-pharmacy",
] as const;

type Point = { x: number; y: number };

function hash(seed: number, x: number, y: number): number {
  let value = (seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Не удалось загрузить ${url}`));
    image.src = url;
  });
}

function tileRect(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  for (let tileY = y; tileY < y + height; tileY += SOURCE_TILE) {
    for (let tileX = x; tileX < x + width; tileX += SOURCE_TILE) {
      context.drawImage(image, tileX, tileY);
    }
  }
  context.restore();
}

function drawRoadGrid(
  context: CanvasRenderingContext2D,
  road: HTMLImageElement,
  pavement: HTMLImageElement,
  origin: Point,
  columns: number,
  rows: number,
): void {
  const totalWidth = columns * BLOCK_WIDTH + (columns + 1) * STREET_WIDTH;
  const totalHeight = rows * BLOCK_HEIGHT + (rows + 1) * STREET_WIDTH;

  for (let column = 0; column <= columns; column += 1) {
    const x = origin.x + column * (BLOCK_WIDTH + STREET_WIDTH);
    tileRect(context, pavement, x, origin.y, STREET_WIDTH, totalHeight);
    tileRect(context, road, x + CELL, origin.y, 3 * CELL, totalHeight);
    context.fillStyle = "#d4b35d";
    for (let y = origin.y + 4; y < origin.y + totalHeight; y += 16) {
      context.fillRect(x + 9, y, 2, 7);
    }
  }

  for (let row = 0; row <= rows; row += 1) {
    const y = origin.y + row * (BLOCK_HEIGHT + STREET_WIDTH);
    tileRect(context, pavement, origin.x, y, totalWidth, STREET_WIDTH);
    tileRect(context, road, origin.x, y + CELL, totalWidth, 3 * CELL);
    context.fillStyle = "#d4b35d";
    for (let x = origin.x + 4; x < origin.x + totalWidth; x += 16) {
      context.fillRect(x, y + 9, 7, 2);
    }
  }

  context.fillStyle = "#e8e3cc";
  for (let column = 0; column <= columns; column += 1) {
    for (let row = 0; row <= rows; row += 1) {
      const x = origin.x + column * (BLOCK_WIDTH + STREET_WIDTH);
      const y = origin.y + row * (BLOCK_HEIGHT + STREET_WIDTH);
      for (let offset = 1; offset < STREET_WIDTH - 2; offset += 4) {
        context.fillRect(x + offset, y + CELL, 2, 3 * CELL);
        context.fillRect(x + CELL, y + offset, 3 * CELL, 2);
      }
    }
  }
}

function drawBlockPlatforms(
  context: CanvasRenderingContext2D,
  pavement: HTMLImageElement,
  origin: Point,
  columns: number,
  rows: number,
): void {
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = origin.x + STREET_WIDTH + column * (BLOCK_WIDTH + STREET_WIDTH);
      const y = origin.y + STREET_WIDTH + row * (BLOCK_HEIGHT + STREET_WIDTH);
      if (column === 1 && row === 1) continue;
      tileRect(context, pavement, x + CELL, y + CELL, BLOCK_WIDTH - 2 * CELL, BLOCK_HEIGHT - 2 * CELL);
    }
  }
}

function drawPark(
  context: CanvasRenderingContext2D,
  images: Map<string, HTMLImageElement>,
  x: number,
  y: number,
): void {
  const water = images.get("terrain:SHALLOW_WATER:0")!;
  const lawn = images.get("terrain:GRASS:1")!;
  tileRect(context, lawn, x, y, BLOCK_WIDTH, BLOCK_HEIGHT);
  tileRect(context, water, x + 36, y + 24, 40, 32);
  context.strokeStyle = "#9f8b5e";
  context.lineWidth = 4;
  context.strokeRect(x + 32, y + 20, 48, 40);
  const tree = images.get("prop:tree-round")!;
  for (const [offsetX, offsetY] of [[12, 20], [88, 20], [12, 68], [88, 68]] as const) {
    context.drawImage(tree, x + offsetX, y + offsetY - tree.height + 8);
  }
}

function drawBuildings(
  context: CanvasRenderingContext2D,
  images: Map<string, HTMLImageElement>,
  origin: Point,
  columns: number,
  rows: number,
): void {
  let buildingIndex = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const blockX = origin.x + STREET_WIDTH + column * (BLOCK_WIDTH + STREET_WIDTH);
      const blockY = origin.y + STREET_WIDTH + row * (BLOCK_HEIGHT + STREET_WIDTH);
      if (column === 1 && row === 1) {
        drawPark(context, images, blockX, blockY);
        continue;
      }
      const firstKey = BUILDING_KEYS[buildingIndex % BUILDING_KEYS.length]!;
      const secondKey = BUILDING_KEYS[(buildingIndex + 3) % BUILDING_KEYS.length]!;
      buildingIndex += 1;
      const first = images.get(`building:${firstKey}`)!;
      const second = images.get(`building:${secondKey}`)!;
      const baseline = blockY + BLOCK_HEIGHT - 8;
      context.drawImage(first, blockX + 8, baseline - first.height);
      context.drawImage(second, blockX + BLOCK_WIDTH - second.width - 8, baseline - second.height);
    }
  }
}

function drawTraffic(context: CanvasRenderingContext2D, origin: Point): void {
  const cars = [
    { x: origin.x + 82, y: origin.y + 6, color: "#ca4e32" },
    { x: origin.x + 250, y: origin.y + 10, color: "#2e83a5" },
    { x: origin.x + 418, y: origin.y + 6, color: "#d69d2f" },
    { x: origin.x + 6, y: origin.y + 174, color: "#437c54" },
    { x: origin.x + 536, y: origin.y + 300, color: "#385ea0" },
  ];
  for (const car of cars) {
    context.fillStyle = "#263945";
    context.fillRect(car.x - 1, car.y - 1, 10, 6);
    context.fillStyle = car.color;
    context.fillRect(car.x, car.y, 8, 4);
    context.fillStyle = "#9ec7ca";
    context.fillRect(car.x + 3, car.y + 1, 3, 2);
  }
}

async function render(canvas: HTMLCanvasElement): Promise<void> {
  const buildingUrls = Object.fromEntries(BUILDING_KEYS.map((key) => [key, getBuilding(key).stages[4]!]));
  const urls = new Map<string, string>();
  for (const kind of ["GRASS", "FOREST", "SAND", "WET_SAND", "SHALLOW_WATER", "DEEP_WATER"] as const) {
    TERRAIN_SPRITES[kind]!.forEach((path, index) => urls.set(`terrain:${kind}:${index}`, gameAssetUrl(path)));
  }
  urls.set("tile:road", TILE_SPRITES.road);
  urls.set("tile:pavement", TILE_SPRITES.pavement);
  urls.set("prop:tree-round", PROP_SPRITES["tree-round"]!);
  urls.set("prop:tree-pine", PROP_SPRITES["tree-pine"]!);
  for (const [key, url] of Object.entries(buildingUrls)) urls.set(`building:${key}`, url);

  const loaded = await Promise.all([...urls].map(async ([key, url]) => [key, await loadImage(url)] as const));
  const images = new Map(loaded);
  const context = canvas.getContext("2d", { alpha: false })!;
  context.imageSmoothingEnabled = false;

  for (let y = 0; y < HEIGHT; y += SOURCE_TILE) {
    for (let x = 0; x < WIDTH; x += SOURCE_TILE) {
      // Keep the exact production 8px art at native resolution. In block-v1
      // one source tile therefore covers a 2x2 group of 4px logical cells.
      const coast = 1080 + Math.round(Math.sin(y / 62) * 34);
      const forest = x < 190 + Math.sin(y / 74) * 35 && y < 610;
      let kind: "GRASS" | "FOREST" | "SAND" | "WET_SAND" | "SHALLOW_WATER" | "DEEP_WATER" = "GRASS";
      if (x >= coast + 24) kind = x >= coast + 48 ? "DEEP_WATER" : "SHALLOW_WATER";
      else if (x >= coast + 8) kind = "WET_SAND";
      else if (x >= coast - 24) kind = "SAND";
      else if (forest) kind = "FOREST";
      const variants = TERRAIN_SPRITES[kind]!;
      const variant = hash(0x54a9, x / SOURCE_TILE, y / SOURCE_TILE) % variants.length;
      context.drawImage(images.get(`terrain:${kind}:${variant}`)!, x, y);
    }
  }

  const pine = images.get("prop:tree-pine")!;
  for (let index = 0; index < 38; index += 1) {
    const x = 18 + hash(91, index, 3) % 155;
    const y = 36 + hash(17, index, 8) % 600;
    context.drawImage(pine, x, y - pine.height + 8);
  }

  const origin = { x: 284, y: 126 };
  const columns = 4;
  const rows = 3;
  drawRoadGrid(context, images.get("tile:road")!, images.get("tile:pavement")!, origin, columns, rows);
  drawBlockPlatforms(context, images.get("tile:pavement")!, origin, columns, rows);
  drawBuildings(context, images, origin, columns, rows);
  drawTraffic(context, origin);
}

export function BlockWorldPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Собираем кварталы…");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void render(canvas).then(() => setStatus("")).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Ошибка renderer-а");
    });
  }, []);

  return <main style={{ minHeight: "100vh", background: "#0d1f23", color: "#dce6df", overflow: "hidden" }}>
    <header style={{ height: 52, display: "flex", alignItems: "center", gap: 28, padding: "0 24px", background: "#0c1d21", borderBottom: "1px solid #294047" }}>
      <strong style={{ letterSpacing: 1.5 }}>TASKTOPIA</strong>
      <span style={{ color: "#8fa6a7", fontSize: 12 }}>ГОРОД</span>
      <strong>Квартальный берег</strong>
      <span style={{ marginLeft: "auto", color: "#8fa6a7", fontSize: 12 }}>BLOCK V1 · 4 PX</span>
    </header>
    <section style={{ position: "relative", width: WIDTH, maxWidth: "100vw", margin: "0 auto" }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Предпросмотр квартального города"
        data-render-cell-px={CELL}
        data-terrain-source="production-v5"
        style={{ display: "block", width: "100%", imageRendering: "pixelated" }}
      />
      {status && <div role="status" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#0d1f23cc" }}>{status}</div>}
      <nav aria-label="Уровень карты" style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", display: "flex", gap: 32, padding: "12px 28px", borderRadius: 12, background: "#0c1d21ee", border: "1px solid #294047", fontSize: 12 }}>
        <span style={{ color: "#819899" }}>Планета</span><span style={{ color: "#819899" }}>Страна</span><strong style={{ color: "#f0cf55" }}>Город</strong>
      </nav>
    </section>
  </main>;
}
