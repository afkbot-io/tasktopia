export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const raw = await response.text();
  let payload: { message?: string } = {};
  try { payload = raw ? JSON.parse(raw) as { message?: string } : {}; } catch { /* Plain-text proxy/server response. */ }
  if (!response.ok) {
    const fallback: Record<number, string> = {
      400: "Некорректный запрос. Проверьте введённые данные",
      401: "Требуется авторизация",
      403: "Доступ запрещён",
      404: "Запрашиваемые данные не найдены",
      409: "Данные конфликтуют с уже существующей записью",
      429: "Слишком много запросов. Попробуйте немного позже",
      500: "Сервер временно недоступен. Попробуйте ещё раз",
      502: "Сервер временно недоступен. Попробуйте ещё раз",
      503: "Сервер временно недоступен. Попробуйте ещё раз",
    };
    throw new ApiError(response.status, payload.message ?? fallback[response.status] ?? `Ошибка HTTP ${response.status}`);
  }
  return payload as T;
}
