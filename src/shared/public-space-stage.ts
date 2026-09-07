/** Three visual milestones; task workflow/status and durable progress stay intact. */
export function publicSpaceRenderStage(stage: number): 1 | 3 | 5 {
  return stage >= 5 ? 5 : stage >= 3 ? 3 : 1;
}
