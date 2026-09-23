import { openMapCity } from "./map-navigation";
import { expect, test } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";

for (const stage of [1, 2, 3, 4, 5]) test(`port terminal stage ${stage} retains its native parcel and image`, async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local renderer fixture only");
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  let taskNumber = 0, selectedId = "";
  const images: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.ok() && response.url().includes("/compact-port-v1/")) images.push(response.url()); });
  // A renderer-only fixture. No port is granted and no coastal proof is fabricated in storage.
  await page.route("**/api/countries/*/cities/*/scene", async route => {
    const response = await route.fetch(), scene = await response.json() as CitySceneDto;
    const tasks = [...scene.chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)];
    const target = tasks.find(task => task.id === selectedId) ?? tasks.find(task => task.footprint.length === 24
      && Math.max(...task.footprint.map(p => p.x)) - Math.min(...task.footprint.map(p => p.x)) === 5
      && Math.max(...task.footprint.map(p => p.y)) - Math.min(...task.footprint.map(p => p.y)) === 3);
    expect(target, "Demo needs a native 6×4 building parcel").toBeTruthy();
    selectedId = target!.id; taskNumber = target!.taskNumber;
    for (const task of tasks.filter(task => task.id === selectedId)) {
      task.buildingType = "compact-port-v1"; task.serviceRole = "PORT";
      task.stage = stage; task.status = stage === 5 ? "COMPLETED" : "IN_PROGRESS";
    }
    await route.fulfill({ response, json: scene });
  });
  await page.goto("/");
    await openMapCity(page);
  await openMapCity(page);
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
  await page.getByLabel("Поиск здания по номеру или названию").fill(String(taskNumber));
  await page.getByRole("option").filter({ hasText: `#${taskNumber}` }).click();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  if (stage >= 3) expect(images.some(url => url.endsWith(`/stage-${stage}.png`))).toBe(true);
  await page.screenshot({ path: info.outputPath(`port-stage-${stage}.png`) });
  expect(errors).toEqual([]);
});
