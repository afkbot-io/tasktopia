import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

test.use({ serviceWorkers: "allow", viewport: { width: 390, height: 844 } });

async function observePwaActivation(page: Page, receive: (entry: object) => void) {
  const marker = "TASKTOPIA_PWA_PUBLIC_STATE ";
  const capture = (message: ConsoleMessage) => {
    const text = message.text();
    if (message.type() !== "info" || !text.startsWith(marker) || text.length > 4096) return;
    try {
      const entry: unknown = JSON.parse(text.slice(marker.length));
      if (entry && typeof entry === "object") receive(entry);
    } catch { /* Diagnostics accept only the owned structured console marker. */ }
  };
  page.on("console", capture);
  const bounded = async <T,>(read: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1000); })]);
    } catch { return undefined; }
    finally { clearTimeout(timer); }
  };
  const installation = page.evaluateHandle(async marker => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("PWA diagnostic registration unavailable");
    const container = navigator.serviceWorker, identities = new WeakMap<ServiceWorker, number>();
    const listeners = new Map<ServiceWorker, () => void>();
    let nextIdentity = 0, sequence = 0;
    const worker = (value: ServiceWorker | null) => {
      if (!value) return null;
      if (!identities.has(value)) identities.set(value, ++nextIdentity);
      return { id: identities.get(value), state: value.state, scriptPath: new URL(value.scriptURL).pathname.slice(0, 160) };
    };
    const notice = () => {
      const value = document.querySelector(".pwa-update-notice")?.getAttribute("data-state");
      return value === "available" || value === "updating" || value === "error" || value === "idle" ? value : null;
    };
    const record = (event: string, subject: ServiceWorker | null = null) => {
      if (sequence >= 128) return;
      const active = registration.active, waiting = registration.waiting, installing = registration.installing, controller = container.controller;
      for (const value of [active, waiting, installing, controller]) {
        if (!value || listeners.has(value)) continue;
        const listener = () => record("statechange", value);
        listeners.set(value, listener); value.addEventListener("statechange", listener);
      }
      console.info(marker + JSON.stringify({ event, sequence: ++sequence, at: performance.now(), notice: notice(),
        active: worker(active), waiting: worker(waiting), installing: worker(installing), controller: worker(controller), subject: worker(subject) }));
    };
    const controllerChange = () => record("controllerchange"), updateFound = () => record("updatefound"), messageError = () => record("messageerror");
    container.addEventListener("controllerchange", controllerChange);
    container.addEventListener("messageerror", messageError);
    registration.addEventListener("updatefound", updateFound);
    let previousNotice = notice();
    const observer = new MutationObserver(() => {
      const current = notice();
      if (current !== previousNotice) { previousNotice = current; record("notice-state"); }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
    record("observer-installed");
    return () => {
      observer.disconnect();
      container.removeEventListener("controllerchange", controllerChange);
      container.removeEventListener("messageerror", messageError);
      registration.removeEventListener("updatefound", updateFound);
      for (const [value, listener] of listeners) value.removeEventListener("statechange", listener);
      listeners.clear();
    };
  }, marker);
  const stop = await bounded(installation);
  // A late diagnostic setup must not leave listeners behind after its bound.
  if (!stop) void installation.then(async handle => { await bounded(handle.evaluate(dispose => dispose())); await bounded(handle.dispose()); }).catch(() => undefined);
  return { coverage: stop ? "observed" : "unavailable", stop: async () => {
    try { if (stop) { await bounded(stop.evaluate(dispose => dispose())); await bounded(stop.dispose()); } }
    finally { page.off("console", capture); }
  } };
}

for (const simulateFailure of [false, true]) test(`PWA offers a waiting release and activates it only on explicit update${simulateFailure ? " after retry" : ""}`, async ({ page, baseURL }, testInfo) => {
  const source = await readFile("dist/public/sw.js", "utf8");
  let version = 1;
  const upstreamRequests = new Set<AbortController>();
  // Real built app and worker at an isolated origin; changing the worker's
  // release identity models a deployment without modifying the running server.
  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    upstreamRequests.add(controller);
    try {
      if (request.url === "/sw.js") {
        response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" });
        const worker = simulateFailure && version === 2 ? source.replace('if (event.data?.type === "TASKTOPIA_SKIP_WAITING") event.waitUntil(self.skipWaiting());', 'if (event.data?.type === "TASKTOPIA_SKIP_WAITING") { if (!self.forestRetry) { self.forestRetry = true; return; } event.waitUntil(self.skipWaiting()); }') : source;
        response.end(worker.replace(/tasktopia-shell-[a-f0-9]+/g, `tasktopia-shell-e2e-${version}`) + `\n// release ${version}\nself.addEventListener('message', e => { if(e.data === 'release-test') e.ports[0].postMessage(${version}); });`);
        return;
      }
      const upstream = await fetch(new URL(request.url!, baseURL), { headers: { accept: request.headers.accept ?? "*/*" }, signal: controller.signal });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else { response.writeHead(502); response.end(); }
    }
    finally { upstreamRequests.delete(controller); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const started = Date.now();
  let phase = "initial navigation";
  const observations: object[] = [];
  const workerEvents: object[] = [];
  let workerObservation: Awaited<ReturnType<typeof observePwaActivation>> | undefined;
  const mark = (next: string) => { phase = next; if (observations.length < 64) observations.push({ phase, elapsedMs: Date.now() - started }); };
  const readWorkerState = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const state = await Promise.race([
        page.evaluate(async () => {
          const worker = (value: ServiceWorker | null) => value ? { state: value.state, scriptPath: new URL(value.scriptURL).pathname } : null;
          const registration = await navigator.serviceWorker.getRegistration();
          return { active: worker(registration?.active ?? null), waiting: worker(registration?.waiting ?? null), installing: worker(registration?.installing ?? null), controller: worker(navigator.serviceWorker.controller) };
        }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); }),
      ]);
      if (observations.length < 64) observations.push({ phase, elapsedMs: Date.now() - started, state });
      return state;
    } finally { clearTimeout(timer); }
  };
  const controlledWorkerReady = async (next: string) => {
    mark(next);
    await expect.poll(readWorkerState, { timeout: 15_000, message: next }).toMatchObject({ active: { state: "activated" }, controller: { state: "activated" } });
  };
  try {
    mark("initial navigation");
    await page.goto(origin);
    await controlledWorkerReady("initial controlled worker");
    const notice = page.getByRole("complementary", { name: "Обновление приложения" });
    await expect(notice).toBeHidden();
    await page.getByLabel("Email").fill("draft@example.test");
    version = 2;
    await controlledWorkerReady("before update check");
    mark("update check");
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error("PWA registration disappeared before update");
      await registration.update();
    });
    mark("waiting release notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Email")).toHaveValue("draft@example.test");
    await testInfo.attach("pwa-update-notice", { body: await page.screenshot({ path: testInfo.outputPath("pwa-update-notice.png") }), contentType: "image/png" });
    await notice.getByRole("button", { name: "Позже", exact: true }).click();
    await expect(notice).toBeHidden();
    await expect(page.getByLabel("Email")).toHaveValue("draft@example.test");
    mark("reload deferred release");
    await page.reload();
    await expect(notice).toBeVisible();
    workerObservation = await observePwaActivation(page, entry => { if (workerEvents.length < 128) workerEvents.push(entry); });
    if (simulateFailure) {
      mark("first activation deliberately ignored");
      await notice.getByRole("button", { name: "Обновить", exact: true }).click();
      await expect(notice).toHaveAttribute("data-state", "updating");
      await expect(notice.getByRole("button", { name: "Позже", exact: true })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath("pwa-updating.png") });
      await expect(notice).toHaveAttribute("data-state", "error", { timeout: 20_000 });
      expect((await new AxeBuilder({ page }).include(".pwa-update-notice").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("pwa-error.png") });
    }
    mark("explicit activation");
    const navigation = page.waitForEvent("framenavigated", frame => frame === page.mainFrame());
    await notice.getByRole("button", { name: simulateFailure ? "Повторить обновление" : "Обновить", exact: true }).click();
    await navigation;
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(notice).toBeHidden();
    await controlledWorkerReady("updated controlled worker");
    mark("active release reply");
    const activeVersion = await page.evaluate(async () => {
      return new Promise<number>((resolve, reject) => {
        const channel = new MessageChannel();
        const close = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
        const timer = setTimeout(() => { close(); reject(new Error("PWA release reply timed out after 5000ms")); }, 5000);
        channel.port1.onmessage = event => { close(); resolve(event.data); };
        channel.port1.onmessageerror = () => { close(); reject(new Error("PWA release reply was not readable")); };
        try { navigator.serviceWorker.controller!.postMessage("release-test", [channel.port2]); }
        catch { close(); reject(new Error("PWA release reply could not be requested")); }
      });
    });
    expect(activeVersion).toBe(2);
    expect(errors).toEqual([]);
    mark("all original assertions passed");
  } finally {
    try { await workerObservation?.stop(); }
    catch { /* Diagnostic cleanup must preserve the original failure. */ }
    try {
      await testInfo.attach("pwa-worker-events", { contentType: "application/json", body: Buffer.from(JSON.stringify({
        coverage: workerObservation?.coverage ?? "not-installed", events: workerEvents, eventsAtCapacity: workerEvents.length === 128,
      }, null, 2)) });
    } catch { /* Console records survive page closure without a final page read. */ }
    try {
      await testInfo.attach("pwa-update-phases", { contentType: "application/json", body: Buffer.from(JSON.stringify({ phase, elapsedMs: Date.now() - started, observations, observationsAtCapacity: observations.length === 64 }, null, 2)) });
    } catch { /* Diagnostic attachment must not mask the original failure. */ }
    try { if (!page.isClosed()) await page.close(); }
    catch { /* Test timeout may already have closed the owned page. */ }
    finally {
      for (const request of upstreamRequests) request.abort();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
