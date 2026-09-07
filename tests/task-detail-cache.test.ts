import { expect, it, vi } from "vitest";
import { clearTaskDetailCache, invalidateTaskDetails, loadTaskDetail, peekTaskDetail } from "../src/client/task-detail-cache";
import type { RealtimeEvent, TaskDto } from "../src/shared/contracts";
import { taskLink, taskResolutionQuery } from "../src/client/task-navigation";

it("reuses opened tasks and invalidates only the changed task, including pending reads", async () => {
  clearTaskDetailCache();
  const first = { id: "a" } as TaskDto;
  const load = vi.fn(async () => first);
  expect(await loadTaskDetail("country", "a", load)).toBe(first);
  expect(await loadTaskDetail("country", "a", load)).toBe(first);
  invalidateTaskDetails({ countryId: "country", id: 1, worldVersion: 1, createdAt: "2026-09-05", type: "task.comment_added", payload: { taskId: "b" } } as RealtimeEvent);
  expect(peekTaskDetail("country", "a")).toBe(first);
  expect(load).toHaveBeenCalledTimes(1);
  invalidateTaskDetails({ countryId: "country", id: 2, worldVersion: 2, createdAt: "2026-09-05", type: "task.comment_added", payload: { taskId: "a" } } as RealtimeEvent);
  expect(peekTaskDetail("country", "a")).toBeUndefined();
  await loadTaskDetail("country", "a", load);
  expect(load).toHaveBeenCalledTimes(2);
  clearTaskDetailCache();
  expect(peekTaskDetail("country", "a")).toBeUndefined();
});

it("uses canonical UUID links and retains explicit country for legacy task numbers", () => {
  expect(taskLink("country", { id: "task", taskNumber: 7 })).toBe("/task/7?countryId=country&taskId=task");
  expect(taskResolutionQuery(new URL("https://example.test/task/7?countryId=country&taskId=task"))).toBe("id=task");
  expect(taskResolutionQuery(new URL("https://example.test/task/7?countryId=country"))).toBe("number=7&countryId=country");
  expect(taskResolutionQuery(new URL("https://example.test/task/7"))).toBe("number=7");
  expect(taskResolutionQuery(new URL("https://example.test/"))).toBeNull();
});
