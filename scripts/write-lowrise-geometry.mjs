import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "assets/pixel-city-pack/manifest.json"), "utf8"));
const catalog = JSON.parse(await readFile(resolve(root, "assets/pixel-city-pack/catalog/buildings.json"), "utf8"));
const catalogBuildings = Object.fromEntries(catalog.buildings.map((building) => [building.key, building]));
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

const legacyCanvasSizes = {
  "house-lowrise-courtyard-brick": [128, 120],
  "house-lowrise-courtyard-plaster": [112, 112],
  "house-lowrise-gallery": [96, 88],
  "house-lowrise-terrace": [112, 144],
  "house-lowrise-corner": [112, 136],
  "house-lowrise-stepped": [128, 152],
  "house-lowrise-green-roof": [112, 136],
  "house-lowrise-loft": [96, 136],
  "house-lowrise-arcade": [128, 144],
  "house-lowrise-modular": [96, 128],
};

const doorBottomInsets = {
  "house-lowrise-courtyard-brick": 8,
  "house-lowrise-courtyard-plaster": 6,
  "house-lowrise-gallery": 6,
  "house-lowrise-terrace": 8,
  "house-lowrise-corner": 6,
  "house-lowrise-stepped": 6,
  "house-lowrise-green-roof": 8,
  "house-lowrise-loft": 6,
  "house-lowrise-arcade": 6,
  "house-lowrise-modular": 8,
};

let projectionReviewsCreated = 0;
for (const [key, planes] of Object.entries(roofEvidence)) {
  const building = manifest.buildings[key];
  if (!building) throw new Error(`Missing manifest building ${key}`);
  const catalogBuilding = catalogBuildings[key];
  if (!catalogBuilding) throw new Error(`Missing catalog building ${key}`);
  const [width, height] = building.spriteSize;
  const [widthCells, depthCells] = building.footprintCells;
  const [legacyWidth, legacyHeight] = legacyCanvasSizes[key];
  const scale = width / legacyWidth;
  const entranceCenterX = Math.floor(widthCells / 2) * 8;
  const doorBaselineY = height - doorBottomInsets[key];
  const scalePoint = ([x, y]) => [
    Math.round(x * scale),
    height - Math.round((legacyHeight - y) * scale),
  ];
  const scaledPlanes = planes.map((plane) => plane.map(scalePoint));
  const directory = resolve(studies, `${key}-v5`);
  await mkdir(directory, { recursive: true });
  let previousDoorReview = {};
  try {
    const previousGeometry = JSON.parse(await readFile(resolve(directory, "geometry.json"), "utf8"));
    previousDoorReview = previousGeometry.doorVisualReview ?? {};
  } catch {
    // A new family starts unreviewed and must be accepted from its contact sheet.
  }
  const geometry = {
    schemaVersion: 1,
    key,
    category: "HOUSE",
    cellSizePx: 8,
    spriteCanvasCells: [width / 8, height / 8],
    physicalFootprintCells: [widthCells, depthCells],
    projectedRoofDepthCells: 5,
    foundationThicknessCells: 2,
    constructionClearanceCells: 1,
    entrance: { side: "S", offset: Math.floor(widthCells / 2) },
    doorSizePx: [16, 16],
    doorLeafSizePx: [12, 14],
    doorBottomInsetPx: doorBottomInsets[key],
    doorVisualReview: {
      moduleBoundsPx: [entranceCenterX - 8, doorBaselineY - 16, entranceCenterX + 8, doorBaselineY],
      leafBoundsPx: [entranceCenterX - 6, doorBaselineY - 14, entranceCenterX + 6, doorBaselineY],
      reviewedStage5Sha256: previousDoorReview.reviewedStage5Sha256 ?? null,
      moduleMatchesVisibleEntrance: previousDoorReview.moduleMatchesVisibleEntrance === true,
      leavesMatchVisibleDoorPixels: previousDoorReview.leavesMatchVisibleDoorPixels === true,
    },
    sitePreviewCells: [widthCells + 4, depthCells + 8],
  };
  const topPlanes = scaledPlanes.map(([backStart, backEnd, frontStart, frontEnd], index) => ({
    name: scaledPlanes.length === 1 ? "main-roof" : `main-roof-section-${index + 1}`,
    role: "primary-roof",
    ...(scaledPlanes.length > 1 ? { primaryRoofGroup: "main-roof", edgeProfile: "parallel-pitched" } : {}),
    backEdge: [backStart, backEnd],
    frontEdge: [frontStart, frontEnd],
  }));
  const frontY = Math.max(...scaledPlanes.map((plane) => plane[2][1]));
  const review = {
    key,
    stage: 5,
    facadeVerticals: [[[3, frontY], [3, height - 2]], [[width - 4, frontY], [width - 4, height - 2]]],
    floorHorizontals: [[[3, height - Math.round(24 * scale)], [width - 4, height - Math.round(24 * scale)]]],
    topPlanes,
    sideFacadeWidthPx: key === "house-lowrise-corner" ? Math.round(6 * scale) : 0,
    primaryRoofIsDominantSurface: false,
    primaryRoofFrontEdgeMatchesEave: false,
    annotationsMatchVisiblePixels: false,
    sameCameraAcrossStages: false,
  };
  await writeFile(resolve(directory, "geometry.json"), `${JSON.stringify(geometry, null, 2)}\n`);
  const reviewPath = resolve(directory, "projection-review.json");
  try {
    await access(reviewPath);
    const previousReview = JSON.parse(await readFile(reviewPath, "utf8"));
    const reviewedEvidenceFingerprint = createHash("sha256").update(JSON.stringify({
      spriteSize: building.spriteSize,
      footprintCells: building.footprintCells,
      stageSha256: catalogBuilding.stageSha256,
      facadeVerticals: review.facadeVerticals,
      floorHorizontals: review.floorHorizontals,
      topPlanes: review.topPlanes,
      sideFacadeWidthPx: review.sideFacadeWidthPx,
    })).digest("hex");
    review.reviewedEvidenceFingerprint = reviewedEvidenceFingerprint;
    const evidenceIsCurrent = previousReview.reviewedEvidenceFingerprint === reviewedEvidenceFingerprint;
    for (const field of [
      "primaryRoofIsDominantSurface",
      "primaryRoofFrontEdgeMatchesEave",
      "annotationsMatchVisiblePixels",
      "sameCameraAcrossStages",
    ]) review[field] = evidenceIsCurrent && previousReview[field] === true;
  } catch {
    projectionReviewsCreated += 1;
    review.reviewedEvidenceFingerprint = createHash("sha256").update(JSON.stringify({
      spriteSize: building.spriteSize,
      footprintCells: building.footprintCells,
      stageSha256: catalogBuilding.stageSha256,
      facadeVerticals: review.facadeVerticals,
      floorHorizontals: review.floorHorizontals,
      topPlanes: review.topPlanes,
      sideFacadeWidthPx: review.sideFacadeWidthPx,
    })).digest("hex");
  }
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify({ geometryContracts: Object.keys(roofEvidence).length, projectionReviewsCreated })}\n`);
