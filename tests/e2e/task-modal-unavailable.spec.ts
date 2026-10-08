import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import type { BootstrapDto, TaskDto } from "../../src/shared/contracts";
import { taskLink } from "../../src/client/task-navigation";

test.skip(process.env.E2E_TASK_MODAL_MUTABLE_FIXTURE !== "true", "Requires an explicitly selected disposable local schema");

type TaskSession = { client: Client; countryId: string; tokenId: string; task?: TaskDto; deleted: boolean };
const sessions = new WeakMap<Page, TaskSession>();

test.afterEach(async ({ page }) => {
  const session = sessions.get(page);
  if (!session) return;
  try { if (session.task && !session.deleted) await deleteOwnTask(page, session.task); }
  finally {
    try { await session.client.close(); }
    finally {
      expect((await page.request.delete(`/api/tokens/${session.tokenId}`)).ok()).toBe(true);
      sessions.delete(page);
    }
  }
});

async function call(page: Page, name: string, fields: Record<string, unknown>) {
  const session = sessions.get(page)!;
  const result = await session.client.callTool({ name, arguments: { countryId: session.countryId, idempotencyKey: randomUUID(), ...fields } });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
}

async function openOwnTask(page: Page): Promise<TaskDto> {
  const databaseUrl = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
  const schema = databaseUrl.searchParams.get("options")?.match(/^-csearch_path=([a-z][a-z0-9_]*)$/)?.[1];
  if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname)
    || databaseUrl.pathname !== "/tasktopia_test" || !schema || schema === "public"
    || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? "")) {
    throw new Error("Task modal QA must use a named disposable schema in local tasktopia_test");
  }
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json() as BootstrapDto;
  const tokenResponse = await page.request.post("/api/tokens", { data: { name: "Task availability QA", scopes: ["tasks:write"], expiresInDays: 30 } });
  expect(tokenResponse.ok(), await tokenResponse.text()).toBe(true);
  const token = await tokenResponse.json() as { id: string; token: string };
  const client = new Client({ name: "task-availability-qa", version: "1.0.0" });
  sessions.set(page, { client, countryId: bootstrap.country.id, tokenId: token.id, deleted: false });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", process.env.E2E_BASE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token.token}` } },
  }));
  // Task creation has no HTTP route. Setup uses the real domain service in the
  // same explicitly guarded test schema; all observed reloads/deletion below
  // go through authenticated MCP and the application's realtime subscriber.
  // tsx is the repository's existing server-script loader; Playwright's own
  // source transform does not support the server's JSON asset imports.
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx",
    "tests/fixtures/seed-task-modal-qa.ts", bootstrap.country.id, bootstrap.initialCity!.id]);
  const task = JSON.parse(stdout) as TaskDto;
  sessions.get(page)!.task = task;
  await page.goto(taskLink(bootstrap.country.id, task));
  await expect(page.locator("#task-title")).toHaveText(task.title);
  await expect(page.getByRole("button", { name: "Ссылка", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Перенести в другой спринт" })).toHaveCount(0);
  return task;
}

async function deleteOwnTask(page: Page, task: TaskDto) {
  if (!task.title.startsWith("QA task modal availability ")) throw new Error("Refusing to delete a shared fixture task");
  await call(page, "task.delete", { taskId: task.id, confirmTitle: task.title });
  sessions.get(page)!.deleted = true;
}

async function refreshOwnTask(page: Page, task: TaskDto) {
  await call(page, "task.update_fields", { taskId: task.id, description: `Availability refresh ${randomUUID()}` });
}

async function expectUnavailable(page: Page) {
  const dialog = page.locator(".task-modal");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.locator("#task-title")).toHaveCount(0);
  await expect(dialog.locator(".task-description, .task-documents, .task-transfer-panel")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Ссылка|Перенести/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Закрыть", exact: true })).toBeVisible();
}

test("real deletion clears an already open task after its authoritative HTTP 404", async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const task = await openOwnTask(page);
  const reload = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tasks/${task.id}`
    && response.request().method() === "GET" && response.status() === 404);
  await deleteOwnTask(page, task);
  expect((await reload).status()).toBe(404);
  await expectUnavailable(page);
  expect(errors).toEqual([]);
  await info.attach("deleted-open-card", { body: JSON.stringify({ taskId: task.id, authoritativeStatus: 404, errors }), contentType: "application/json" });
});

test("a definitive HTTP 403 clears task details and actions on realtime refresh", async ({ page }) => {
  test.setTimeout(90_000);
  const task = await openOwnTask(page);
  const endpoint = `**/api/tasks/${task.id}`;
  try {
    await page.route(endpoint, route => route.fulfill({ status: 403, json: { message: "QA: task access revoked" } }));
    await refreshOwnTask(page, task);
    await expect(page.locator(".task-modal").getByRole("alert")).toContainText("QA: task access revoked");
    await expect(page.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
    await expectUnavailable(page);
  } finally {
    await page.unroute(endpoint);
    await deleteOwnTask(page, task);
  }
});

test("temporary HTTP 503 preserves the loaded card and a later refresh recovers", async ({ page }) => {
  test.setTimeout(90_000);
  const task = await openOwnTask(page);
  const endpoint = `**/api/tasks/${task.id}`;
  try {
    await page.route(endpoint, route => route.fulfill({ status: 503, json: { message: "QA: temporary task service failure" } }));
    await refreshOwnTask(page, task);
    await expect(page.locator(".task-modal").getByRole("alert")).toContainText("QA: temporary task service failure");
    await expect(page.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
    await expect(page.locator("#task-title")).toHaveText(task.title);
    await expect(page.getByRole("button", { name: "Ссылка", exact: true })).toBeVisible();
    await page.unroute(endpoint);
    const reload = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tasks/${task.id}`
      && response.request().method() === "GET" && response.status() === 200);
    await refreshOwnTask(page, task);
    await reload;
    await expect(page.locator(".task-modal").getByRole("alert")).toHaveCount(0);
    await expect(page.locator("#task-title")).toHaveText(task.title);
  } finally {
    await page.unroute(endpoint);
    await deleteOwnTask(page, task);
  }
});
