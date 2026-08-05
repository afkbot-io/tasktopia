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

  it("does not declare an empty DELETE request as JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/countries/country-1/members/user-1", { method: "DELETE" });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).has("content-type")).toBe(false);
  });

  it("declares a serialized JSON string body as JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/countries", { method: "POST", json: { name: "Project" } });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("content-type")).toBe("application/json");
    expect(request.body).toBe(JSON.stringify({ name: "Project" }));
  });

  it("preserves explicit text and FormData request semantics", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/text", { method: "POST", body: "plain", headers: { "content-type": "text/plain" } });
    const form = new FormData();
    form.set("name", "Project");
    await api("/api/form", { method: "POST", body: form });

    const textRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const formRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(textRequest.headers).get("content-type")).toBe("text/plain");
    expect(textRequest.body).toBe("plain");
    expect(new Headers(formRequest.headers).has("content-type")).toBe(false);
    expect(formRequest.body).toBe(form);
  });
});
