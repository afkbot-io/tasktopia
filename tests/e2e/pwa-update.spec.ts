import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow", viewport: { width: 390, height: 844 } });

test("PWA offers a waiting release and activates it only on explicit update", async ({ page, baseURL }, testInfo) => {
  const source = await readFile("dist/public/sw.js", "utf8");
  let version = 1;
  // Real built app and worker at an isolated origin; changing the worker's
  // release identity models a deployment without modifying the running server.
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/sw.js") {
        response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" });
        response.end(source.replace(/tasktopia-shell-[a-f0-9]+/g, `tasktopia-shell-e2e-${version}`) + `\n// release ${version}\nself.addEventListener('message', e => { if(e.data === 'release-test') e.ports[0].postMessage(${version}); });`);
        return;
      }
      const upstream = await fetch(new URL(request.url!, baseURL), { headers: { accept: request.headers.accept ?? "*/*" } });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { response.writeHead(502); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    });
    const notice = page.getByRole("complementary", { name: "Обновление приложения" });
    await expect(notice).toBeHidden();
    await page.getByLabel("Email").fill("draft@example.test");
    version = 2;
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Email")).toHaveValue("draft@example.test");
    await testInfo.attach("pwa-update-notice", { body: await page.screenshot({ path: testInfo.outputPath("pwa-update-notice.png") }), contentType: "image/png" });
    const navigation = page.waitForEvent("framenavigated", frame => frame === page.mainFrame());
    await notice.getByRole("button", { name: "Обновить", exact: true }).click();
    await navigation;
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(notice).toBeHidden();
    const activeVersion = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      return new Promise<number>(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = event => resolve(event.data);
        navigator.serviceWorker.controller!.postMessage("release-test", [channel.port2]);
      });
    });
    expect(activeVersion).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
