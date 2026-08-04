import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/client/api";

describe("client API errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a structured server message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response(
      JSON.stringify({ message: "Неверный email или пароль" }),
      { status: 401, headers: { "content-type": "application/json" } },
    )));

    await expect(api("/api/auth/login")).rejects.toEqual(
      new ApiError(401, "Неверный email или пароль"),
    );
  });

  it("turns a plain Bad Request response into an understandable message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Response("Bad Request", {
      status: 400,
      headers: { "content-type": "text/plain" },
    })));

    await expect(api("/api/auth/register")).rejects.toEqual(
      new ApiError(400, "Некорректный запрос. Проверьте введённые данные"),
    );
  });
});
