import type { TaskAttachmentDto, TaskChecklistItemDto, TaskCommentDto, TaskDefectDto, TaskDocumentDto,
  TaskDto, TaskEventDto, TaskLinkDto, TaskSearchResultDto } from "./contracts";

export type TaskResultMode = "full" | "compact";
export type TaskCommandResultDto = Pick<TaskDto, "id" | "taskNumber" | "cityId" | "districtId" | "title" | "workItemType" |
  "estimate" | "priority" | "status" | "progress" | "stage" | "updatedAt"> & {
  kind: "task.command-result"; version: 1; countryId: string;
};
export type TaskMutationResult<Mode extends TaskResultMode> = Mode extends "compact" ? TaskCommandResultDto : TaskDto;
export type TaskDocumentMetadataDto = Omit<TaskDocumentDto, "content"> & { isFilled: boolean; contentLength: number };
export type TaskCollectionCounts = {
  comments: number; events: number; documents: number; filledDocuments: number; attachments: number;
  mergeRequests: number; checklistTotal: number; checklistDone: number; defects: number; activeDefects: number; dependencies: number;
};
export type TaskCardDto = Omit<TaskDto, "systemAnalysis" | "architecture" | "designSystem" | "implementationPlan" |
  "mergeRequests" | "attachments" | "documents" | "checklist" | "comments" | "dependencies" | "events" | "defects"> & {
  kind: "task.card"; version: 1; countryId: string; counts: TaskCollectionCounts;
  documentMetadata: TaskDocumentMetadataDto[]; documentsNextCursor: string | null;
};
export type TaskCollectionItems = {
  comments: TaskCommentDto; events: TaskEventDto; defects: TaskDefectDto; attachments: TaskAttachmentDto;
  documents: TaskDocumentMetadataDto; checklist: TaskChecklistItemDto;
  dependencies: NonNullable<TaskDto["dependencies"]>[number]; mergeRequests: TaskLinkDto;
};
export type TaskCollection = keyof TaskCollectionItems;
export type TaskCollectionPageDto<Collection extends TaskCollection = TaskCollection> = {
  kind: "task.collection-page"; version: 1; countryId: string; taskId: string; collection: Collection;
  items: TaskCollectionItems[Collection][]; nextCursor: string | null;
};
export type TaskListItemDto = Pick<TaskDto, "id" | "taskNumber" | "cityId" | "districtId" | "title" | "workItemType" |
  "estimate" | "priority" | "status" | "progress" | "stage" | "updatedAt"> &
  Pick<TaskSearchResultDto, "cityName" | "cityCenter" | "cityBounds" | "districtName" | "origin">;
export type TaskListPageDto = { kind: "task.list-page"; version: 1; countryId: string; items: TaskListItemDto[]; nextCursor: string | null };
