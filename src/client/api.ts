import { SAFE_HTTP_ERROR_MESSAGES } from "../shared/http-errors";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type ApiInit = Omit<RequestInit, "body"> & (
  | { json: unknown; body?: never }
  | { body?: BodyInit | null; json?: never }
);

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const { json, ...requestInit } = init ?? {};
  const hasJson = init !== undefined && "json" in init;
  const body = hasJson ? JSON.stringify(json) : requestInit.body;
  const headers = new Headers(requestInit.headers);
  if (hasJson && body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    credentials: "include",
    ...requestInit,
    body,
    headers,
  });
  const raw = await response.text();
  let payload: { message?: string } = {};
  try { payload = raw ? JSON.parse(raw) as { message?: string } : {}; } catch { /* Plain-text proxy/server response. */ }
  if (!response.ok) {
    throw new ApiError(response.status, payload.message ?? SAFE_HTTP_ERROR_MESSAGES[response.status] ?? `Ошибка HTTP ${response.status}`);
  }
  return payload as T;
}
