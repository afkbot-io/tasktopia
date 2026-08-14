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

export type ApiResponseMetrics = {
  decodedBytes: number;
  requestMs: number;
  parseMs: number;
};

export type ApiResult<T> = { data: T; headers: Headers; metrics: ApiResponseMetrics };

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export async function apiWithMetrics<T>(path: string, init?: ApiInit): Promise<ApiResult<T>> {
  const { json, ...requestInit } = init ?? {};
  const hasJson = init !== undefined && "json" in init;
  const body = hasJson ? JSON.stringify(json) : requestInit.body;
  const headers = new Headers(requestInit.headers);
  if (hasJson && body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const requestStartedAt = performance.now();
  const response = await fetch(path, {
    credentials: "include",
    ...requestInit,
    body,
    headers,
  });
  const raw = await response.text();
  const requestMs = performance.now() - requestStartedAt;
  const parseStartedAt = performance.now();
  let payload: { message?: string } = {};
  try { payload = raw ? JSON.parse(raw) as { message?: string } : {}; } catch { /* Plain-text proxy/server response. */ }
  const parseMs = performance.now() - parseStartedAt;
  if (!response.ok) {
    throw new ApiError(response.status, payload.message ?? SAFE_HTTP_ERROR_MESSAGES[response.status] ?? `Ошибка HTTP ${response.status}`);
  }
  return {
    data: payload as T,
    headers: response.headers,
    metrics: { decodedBytes: utf8ByteLength(raw), requestMs, parseMs },
  };
}

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  return (await apiWithMetrics<T>(path, init)).data;
}
