import { z } from "zod";
import { TASK_COLLECTIONS } from "./task-collection-read";

const page = { cursor: z.string().min(1).max(8192).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) };
export const taskListPageSchema = z.object({ countryId: z.string().uuid(), ...page,
  q: z.string().trim().max(160).optional(), cityId: z.string().uuid().optional(), districtId: z.string().uuid().optional(),
  status: z.enum(["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"]).optional(),
  workItemType: z.enum(["TASK", "BUG", "RELEASE", "HOTFIX"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  assigneeUserId: z.string().uuid().optional(),
}).strict();
export const taskCollectionPageSchema = z.object({ countryId: z.string().uuid(), taskId: z.string().uuid(), collection: z.enum(TASK_COLLECTIONS),
  ...page, order: z.enum(["asc", "desc"]).optional() }).strict();
