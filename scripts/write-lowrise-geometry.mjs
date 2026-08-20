import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "assets/pixel-city-pack/manifest.json"), "utf8"));
const studies = resolve(root, "assets/pixel-city-pack/reference/ai-authored/building-stage-study");

const roofEvidence = {
  "house-lowrise-arcade": [[[8, 26], [119, 26], [2, 45], [125, 45]]],
  "house-lowrise-corner": [[[8, 34], [103, 34], [3, 52], [108, 52]]],
  "house-lowrise-courtyard-brick": [[[10, 33], [117, 33], [2, 53], [125, 53]]],
  "house-lowrise-courtyard-plaster": [[[8, 28], [103, 28], [2, 46], [109, 46]]],
  "house-lowrise-gallery": [[[7, 24], [88, 24], [2, 36], [93, 36]]],
  "house-lowrise-green-roof": [[[7, 20], [104, 20], [2, 39], [109, 39]]],
  "house-lowrise-loft": [
    [[5, 52], [25, 40], [5, 68], [25, 56]],
    [[27, 52], [47, 40], [27, 68], [47, 56]],
    [[49, 52], [69, 40], [49, 68], [69, 56]],
    [[71, 52], [91, 40], [71, 68], [91, 56]],
  ],
  "house-lowrise-modular": [[[6, 9], [89, 9], [2, 32], [93, 32]]],
  "house-lowrise-stepped": [
    [[4, 45], [38, 45], [3, 60], [39, 60]],
    [[40, 24], [88, 24], [39, 39], [89, 39]],
    [[90, 45], [124, 45], [89, 60], [125, 60]],
  ],
  "house-lowrise-terrace": [[[7, 15], [104, 15], [2, 31], [109, 31]]],
};

let projectionReviewsCreated = 0;
for (const [key, planes] of Object.entries(roofEvidence)) {
  const building = manifest.buildings[key];
  if (!building) throw new Error(`Missing manifest building ${key}`);
  const [width, height] = building.spriteSize;
  const [widthCells, depthCells] = building.footprintCells;
  const directory = resolve(studies, `${key}-v5`);
  await mkdir(directory, { recursive: true });
  const geometry = {
    schemaVersion: 1,
    key,
    category: "HOUSE",
    cellSizePx: 8,
    spriteCanvasCells: [width / 8, height / 8],
    physicalFootprintCells: [widthCells, depthCells],
    projectedRoofDepthCells: 3,
    foundationThicknessCells: 2,
    constructionClearanceCells: 1,
    entrance: { side: "S", offset: Math.floor(widthCells / 2) },
    doorSizePx: [16, 16],
    doorLeafSizePx: [12, 14],
    doorBottomInsetPx: 0,
    sitePreviewCells: [widthCells + 4, depthCells + 8],
  };
  const topPlanes = planes.map(([backStart, backEnd, frontStart, frontEnd], index) => ({
    name: planes.length === 1 ? "main-roof" : `main-roof-section-${index + 1}`,
    role: "primary-roof",
    ...(planes.length > 1 ? { primaryRoofGroup: "main-roof", edgeProfile: "parallel-pitched" } : {}),
    backEdge: [backStart, backEnd],
    frontEdge: [frontStart, frontEnd],
  }));
  const frontY = Math.max(...planes.map((plane) => plane[2][1]));
  const review = {
    key,
    stage: 5,
    facadeVerticals: [[[3, frontY], [3, height - 2]], [[width - 4, frontY], [width - 4, height - 2]]],
    floorHorizontals: [[[3, height - 24], [width - 4, height - 24]]],
    topPlanes,
    sideFacadeWidthPx: key === "house-lowrise-corner" ? 6 : 0,
    primaryRoofIsDominantSurface: false,
    primaryRoofFrontEdgeMatchesEave: false,
    annotationsMatchVisiblePixels: false,
    sameCameraAcrossStages: false,
  };
  await writeFile(resolve(directory, "geometry.json"), `${JSON.stringify(geometry, null, 2)}\n`);
  const reviewPath = resolve(directory, "projection-review.json");
  try {
    await access(reviewPath);
  } catch {
    // Projection confirmations are a human visual gate. A new review starts
    // rejected and must be explicitly accepted after inspecting the overlays;
    // rerunning geometry generation never overwrites an existing decision.
    await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
    projectionReviewsCreated += 1;
  }
}

process.stdout.write(`${JSON.stringify({ geometryContracts: Object.keys(roofEvidence).length, projectionReviewsCreated })}\n`);
