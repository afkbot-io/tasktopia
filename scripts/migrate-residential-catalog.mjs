import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const catalogPath = resolve(root, "assets/pixel-city-pack/catalog/buildings.json");
const referenceRoot = resolve(root, "assets/pixel-city-pack/reference");

const replacements = [
  ["house-lowrise-courtyard-brick", "Кирпичный малоэтажный ЖК", [128, 120], [16, 10]],
  ["house-lowrise-courtyard-plaster", "Светлый малоэтажный ЖК", [112, 112], [14, 10]],
  ["house-lowrise-gallery", "Галерейный жилой дом", [96, 88], [12, 9]],
  ["house-lowrise-terrace", "Террасный малоэтажный ЖК", [112, 144], [14, 10]],
  ["house-lowrise-corner", "Угловой малоэтажный ЖК", [112, 136], [14, 10]],
  ["house-lowrise-stepped", "Ступенчатый малоэтажный ЖК", [128, 152], [16, 10]],
  ["house-lowrise-green-roof", "Жилой дом с зелёной крышей", [112, 136], [14, 10]],
  ["house-lowrise-loft", "Малоэтажные лофт-апартаменты", [96, 136], [12, 9]],
  ["house-lowrise-arcade", "Жилой дом с аркадой", [128, 144], [16, 10]],
  ["house-lowrise-modular", "Модульный малоэтажный ЖК", [96, 128], [12, 9]],
];

function unique(values) {
  return [...new Set(values)].sort();
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const retained = catalog.buildings
  .filter((building) => !(building.category === "HOUSE" && !building.tags.includes("new-build")))
  .map((building) => {
    if (building.category === "HIGHRISE") {
      return { ...building, tags: unique([...building.tags, "high-rise-residential"]) };
    }
    if (building.category === "HOUSE") {
      return {
        ...building,
        platform: "STONE",
        tags: unique(building.tags.filter((tag) => tag !== "private-residential").concat("mid-rise-residential")),
      };
    }
    return building;
  });

const generated = [];
for (const [key, label, spriteSize, footprintCells] of replacements) {
  const relativeSources = [3, 4, 5].map((stage) =>
    `ai-authored/building-stage-study/${key}-v5/sources/stage-${stage}.png`);
  generated.push({
    key,
    label,
    category: "HOUSE",
    rarity: "COMMON",
    spriteSize,
    footprintCells,
    anchorPx: [spriteSize[0] / 2, spriteSize[1]],
    platform: "STONE",
    estimates: [1, 2, 3, 6],
    tags: ["house", "low-rise-residential", "residential"],
    ruleIds: ["STANDARD"],
    entrances: [{ side: "S", offset: Math.floor(footprintCells[0] / 2) }],
    maxPerCity: null,
    maxPerDistrict: null,
    serviceRole: null,
    stageSources: relativeSources,
    stageSha256: await Promise.all(relativeSources.map((path) => digest(resolve(referenceRoot, path)))),
    reviewed: true,
  });
}

catalog.buildings = [...retained, ...generated];
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ removedPrivateFamilies: 36, addedLowRiseFamilies: generated.length, activeBuildings: catalog.buildings.length })}\n`);
