/** Task numbers are country-local. UUID remains canonical after relocation. */
export function taskLink(countryId: string, task: { id: string; taskNumber: number }): string {
  return `/task/${task.taskNumber}?${new URLSearchParams({ countryId, taskId: task.id })}`;
}
export function taskResolutionQuery(url: URL): string | null {
  if (/^\/task\/?$/.test(url.pathname)) {
    const id = url.searchParams.get('taskId');
    return id && /^[a-f0-9-]{36}$/i.test(id) ? new URLSearchParams({ id }).toString() : null;
  }
  const match = /^\/task\/(\d{1,9})\/?$/.exec(url.pathname);
  if (!match || Number(match[1]) < 1) return null;
  const id = url.searchParams.get("taskId");
  if (id) return new URLSearchParams({ id }).toString();
  const query = new URLSearchParams({ number: String(Number(match[1])) });
  const countryId = url.searchParams.get("countryId");
  if (countryId) query.set("countryId", countryId);
  return query.toString();
}
