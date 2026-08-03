const stages = [
  {
    name: "ПЛАНИРОВАНИЕ",
    status: "planning",
    threshold: 0,
    accent: "#f4bd49",
    event: "Гекс выделен под задачу",
    detail: "mcp.task.create → planning",
  },
  {
    name: "НАЧАЛО РАБОТ",
    status: "started",
    threshold: 25,
    accent: "#e6a84a",
    event: "Заложен фундамент",
    detail: "mcp.task.update_progress → 25%",
  },
  {
    name: "В РАБОТЕ",
    status: "in_progress",
    threshold: 50,
    accent: "#5bc7c4",
    event: "Каркас поднят",
    detail: "mcp.task.update_progress → 50%",
  },
  {
    name: "ТЕСТИРОВАНИЕ",
    status: "testing",
    threshold: 75,
    accent: "#80aee8",
    event: "Объект передан на проверку",
    detail: "mcp.task.change_status → testing",
  },
  {
    name: "ЗАВЕРШЕНО",
    status: "done",
    threshold: 100,
    accent: "#b9e653",
    event: "Дом принят районом",
    detail: "mcp.task.complete → done",
  },
];

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const hexLayout = {
  radius: 70,
  xStep: 105,
  yStep: Math.sqrt(3) * 70,
  originX: 110,
  originY: 66,
  columns: 8,
  rows: 5,
};

const primaryRoad = [
  [0, 4], [1, 3], [2, 3], [3, 2], [4, 2], [5, 1], [6, 1], [7, 0],
];
const roadBranch = [[2, 3], [2, 2], [2, 1]];
const houseACell = [3, 1];
const houseBCell = [4, 1];

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function cellKey(column, row) {
  return `${column}:${row}`;
}

function hexCenter(column, row) {
  return {
    x: hexLayout.originX + column * hexLayout.xStep,
    y: hexLayout.originY + row * hexLayout.yStep + (column % 2 ? hexLayout.yStep / 2 : 0),
  };
}

function hexPoints(x, y, radius = hexLayout.radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (index * 60);
    return `${x + radius * Math.cos(angle)},${y + radius * Math.sin(angle)}`;
  }).join(" ");
}

function roadPath(cells) {
  return cells
    .map(([column, row], index) => {
      const point = hexCenter(column, row);
      return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
    })
    .join(" ");
}

function addRoad(group, cells) {
  const data = roadPath(cells);
  group.append(
    svgElement("path", { d: data, class: "road-border" }),
    svgElement("path", { d: data, class: "road-asphalt" }),
    svgElement("path", { d: data, class: "road-line" }),
  );
}

function addTree(group, column, row, offsetX = 0, offsetY = 0, scale = 1) {
  const center = hexCenter(column, row);
  const tree = svgElement("g", {
    transform: `translate(${center.x + offsetX} ${center.y + offsetY}) scale(${scale})`,
    "aria-hidden": "true",
  });
  tree.append(
    svgElement("rect", { x: -3, y: 8, width: 6, height: 18, class: "tree-trunk" }),
    svgElement("circle", { cx: 0, cy: 0, r: 17, class: "tree-crown" }),
    svgElement("circle", { cx: -5, cy: -6, r: 7, class: "tree-highlight" }),
  );
  group.append(tree);
}

function addMapBadge(group, { x, y, width, selected = false, label, id }) {
  const badge = svgElement("g", { class: `map-badge${selected ? " selected" : ""}` });
  badge.append(svgElement("rect", { x, y, width, height: 28, rx: 2 }));
  if (!selected) badge.append(svgElement("circle", { cx: x + 14, cy: y + 14, r: 4, class: "badge-dot" }));
  const text = svgElement("text", { x: x + (selected ? 10 : 25), y: y + 18, id });
  text.textContent = label;
  badge.append(text);
  group.append(badge);
}

function addBuildingImages(group, { cell, directory, prefix, width, height, activeStage = null }) {
  const center = hexCenter(...cell);
  const x = center.x - width / 2;
  const y = center.y - height + 51;
  const names = ["01-planning", "02-foundation", "03-frame", "04-finishing", "05-complete"];

  names.forEach((name, index) => {
    const image = svgElement("image", {
      x,
      y,
      width,
      height,
      preserveAspectRatio: "xMidYMid meet",
      class: `map-sprite${activeStage === index ? " active" : ""}${activeStage === null && index === 4 ? " secondary-sprite" : ""}`,
      "data-building": prefix,
      "data-stage-image": index,
      href: `./assets/${directory}/${name}.png`,
    });
    image.setAttributeNS(XLINK_NS, "href", `./assets/${directory}/${name}.png`);
    group.append(image);
  });
}

function renderHexWorld() {
  const svg = document.querySelector("#hexWorld");
  svg.replaceChildren();

  const roadCells = new Set([...primaryRoad, ...roadBranch].map(([column, row]) => cellKey(column, row)));
  const buildingCells = new Set([cellKey(...houseACell), cellKey(...houseBCell)]);

  const terrainLayer = svgElement("g", { id: "terrainLayer" });
  const roadLayer = svgElement("g", { id: "roadLayer" });
  const decorationLayer = svgElement("g", { id: "decorationLayer" });
  const buildingLayer = svgElement("g", { id: "buildingLayer" });
  const uiLayer = svgElement("g", { id: "mapUiLayer" });

  for (let column = 0; column < hexLayout.columns; column += 1) {
    for (let row = 0; row < hexLayout.rows; row += 1) {
      const center = hexCenter(column, row);
      const key = cellKey(column, row);
      const variant = ["grass-a", "grass-b", "grass-c", "meadow"][(column * 5 + row * 3) % 4];
      const type = roadCells.has(key) ? "road-cell" : buildingCells.has(key) ? "building-cell" : variant;
      terrainLayer.append(svgElement("polygon", {
        points: hexPoints(center.x, center.y),
        class: `hex-tile ${type}`,
        "data-cell": key,
      }));

      if (!roadCells.has(key) && !buildingCells.has(key) && (column * 7 + row * 11) % 5 === 0) {
        terrainLayer.append(svgElement("circle", {
          cx: center.x - 17,
          cy: center.y + 13,
          r: 3.2,
          class: "hex-texture-dot",
        }));
      }
    }
  }

  addRoad(roadLayer, primaryRoad);
  addRoad(roadLayer, roadBranch);
  [primaryRoad[0], primaryRoad.at(-1), roadBranch.at(-1)].forEach(([column, row]) => {
    const center = hexCenter(column, row);
    roadLayer.append(svgElement("circle", { cx: center.x, cy: center.y, r: 19, class: "road-node" }));
    roadLayer.append(svgElement("circle", { cx: center.x, cy: center.y, r: 13, fill: "#4e5955" }));
  });

  const selectedCenter = hexCenter(...houseACell);
  const neighborCenter = hexCenter(...houseBCell);
  roadLayer.append(
    svgElement("polygon", { points: hexPoints(neighborCenter.x, neighborCenter.y, 66), class: "neighbor-hex" }),
    svgElement("polygon", { points: hexPoints(selectedCenter.x, selectedCenter.y, 66), class: "selected-hex" }),
  );

  addTree(decorationLayer, 0, 1, -8, 4, 1.05);
  addTree(decorationLayer, 1, 0, 4, 2, 0.82);
  addTree(decorationLayer, 6, 3, 10, -4, 0.9);
  addTree(decorationLayer, 7, 3, -6, 7, 1.1);
  addTree(decorationLayer, 5, 4, 8, 2, 0.75);

  const houseB = svgElement("g", { id: "houseB", "data-stage": "4" });
  addBuildingImages(houseB, {
    cell: houseBCell,
    directory: "hex-house-b-stages",
    prefix: "B",
    width: 174,
    height: 192,
    activeStage: null,
  });
  buildingLayer.append(houseB);

  const houseA = svgElement("g", { id: "houseA", "data-stage": "0" });
  addBuildingImages(houseA, {
    cell: houseACell,
    directory: "hex-house-a-stages",
    prefix: "A",
    width: 194,
    height: 213,
    activeStage: 0,
  });
  const constructionFx = svgElement("g", { class: "construction-fx" });
  constructionFx.append(
    svgElement("circle", { cx: selectedCenter.x - 33, cy: selectedCenter.y + 20, r: 5 }),
    svgElement("circle", { cx: selectedCenter.x + 31, cy: selectedCenter.y + 8, r: 4 }),
    svgElement("circle", { cx: selectedCenter.x + 2, cy: selectedCenter.y + 35, r: 3.5 }),
  );
  houseA.append(constructionFx);
  buildingLayer.append(houseA);

  addMapBadge(uiLayer, {
    x: neighborCenter.x + 28,
    y: neighborCenter.y - 132,
    width: 116,
    label: "TC–011 · DONE",
  });
  addMapBadge(uiLayer, {
    x: selectedCenter.x - 116,
    y: selectedCenter.y - 149,
    width: 146,
    label: "A–17 · ПЛАНИРОВАНИЕ",
    id: "floatingStatus",
    selected: true,
  });

  svg.append(terrainLayer, roadLayer, decorationLayer, buildingLayer, uiLayer);
}

renderHexWorld();

const root = document.documentElement;
const building = document.querySelector("#houseA");
const sprites = [...document.querySelectorAll('[data-building="A"][data-stage-image]')];
const stageButtons = [...document.querySelectorAll(".stage-button")];
const progressInput = document.querySelector("#progressInput");
const progressValue = document.querySelector("#progressValue");
const districtProgress = document.querySelector("#districtProgress");
const statusBadge = document.querySelector("#statusBadge");
const floatingStatus = document.querySelector("#floatingStatus");
const stageCounter = document.querySelector("#stageCounter");
const eventLog = document.querySelector("#eventLog");
const eventPayload = document.querySelector("#eventPayload");
const playButton = document.querySelector("#playButton");
const resetButton = document.querySelector("#resetButton");

let currentStage = 0;
let currentProgress = 0;
let playbackTimer = null;
let recordedStages = new Set([0]);

function stageForProgress(progress) {
  if (progress >= 88) return 4;
  if (progress >= 63) return 3;
  if (progress >= 38) return 2;
  if (progress >= 13) return 1;
  return 0;
}

function formatPayload(stage, progress) {
  return JSON.stringify(
    {
      taskId: "TC-017",
      hex: { q: houseACell[0], r: houseACell[1] },
      status: stage.status,
      progress,
      source: "mcp",
    },
    null,
    2,
  );
}

function addEvent(stageIndex) {
  if (recordedStages.has(stageIndex)) return;
  recordedStages.add(stageIndex);

  const stage = stages[stageIndex];
  const item = document.createElement("li");
  item.innerHTML = `
    <span class="event-node"></span>
    <div><strong>${stage.event}</strong><small>${stage.detail} · только что</small></div>
  `;
  eventLog.prepend(item);
}

function render(progress, options = {}) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const nextStage = options.forceStage ?? stageForProgress(safeProgress);
  const stageChanged = nextStage !== currentStage;

  currentProgress = safeProgress;
  currentStage = nextStage;
  const stage = stages[currentStage];

  root.style.setProperty("--stage-accent", stage.accent);
  root.style.setProperty("--progress", `${safeProgress}%`);
  building.dataset.stage = String(currentStage);

  sprites.forEach((sprite, index) => sprite.classList.toggle("active", index === currentStage));
  stageButtons.forEach((button, index) => {
    const active = index === currentStage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  progressInput.value = String(safeProgress);
  progressValue.textContent = `${safeProgress}%`;
  districtProgress.textContent = `${Math.round((safeProgress + 100) / 2)}%`;
  statusBadge.textContent = stage.name;
  floatingStatus.textContent = `A–17 · ${stage.name}`;
  stageCounter.textContent = `${String(currentStage + 1).padStart(2, "0")} / 05`;
  eventPayload.textContent = formatPayload(stage, safeProgress);

  if (stageChanged && options.record !== false) addEvent(currentStage);
}

function selectStage(index) {
  stopPlayback();
  render(stages[index].threshold, { forceStage: index });
}

function startPlayback() {
  if (playbackTimer) {
    stopPlayback();
    return;
  }

  if (currentProgress >= 100) reset(false);
  playButton.classList.add("playing");
  playButton.querySelector(".play-icon").textContent = "Ⅱ";
  playButton.querySelector("span:last-child").textContent = "ОСТАНОВИТЬ СТРОЙКУ";

  playbackTimer = window.setInterval(() => {
    const next = Math.min(100, currentProgress + 1);
    render(next);
    if (next >= 100) stopPlayback();
  }, 70);
}

function stopPlayback() {
  if (playbackTimer) window.clearInterval(playbackTimer);
  playbackTimer = null;
  playButton.classList.remove("playing");
  playButton.querySelector(".play-icon").textContent = "▶";
  playButton.querySelector("span:last-child").textContent = currentProgress >= 100 ? "ПОВТОРИТЬ СТРОЙКУ" : "ЗАПУСТИТЬ СТРОЙКУ";
}

function reset(stop = true) {
  if (stop) stopPlayback();
  recordedStages = new Set([0]);
  eventLog.innerHTML = `
    <li>
      <span class="event-node"></span>
      <div><strong>Задача создана</strong><small>Источник: mcp.task.create · гекс A–17</small></div>
    </li>
  `;
  render(0, { forceStage: 0, record: false });
}

stageButtons.forEach((button) => {
  button.addEventListener("click", () => selectStage(Number(button.dataset.stage)));
});

progressInput.addEventListener("input", (event) => {
  stopPlayback();
  render(Number(event.target.value));
});

playButton.addEventListener("click", startPlayback);
resetButton.addEventListener("click", () => reset());

window.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const delta = event.key === "ArrowRight" ? 1 : -1;
  selectStage(Math.max(0, Math.min(stages.length - 1, currentStage + delta)));
});

render(0, { forceStage: 0, record: false });
