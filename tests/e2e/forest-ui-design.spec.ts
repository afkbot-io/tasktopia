import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

async function surfaceColors(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (value: string) => {
      const rgb = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => {
        const c = n / 255;
        return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!;
    };
    const background = luminance(style.backgroundColor);
    const text = luminance(style.color);
    return { background, contrast: (Math.max(background, text) + .05) / (Math.min(background, text) + .05), font: style.fontFamily, radius: parseFloat(style.borderRadius) };
  });
}

test("вход использует хвойную поверхность и читаемые локальные шрифты", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Войти в Tasktopia" })).toBeVisible();
  const panel = page.locator(".auth-screen > section:last-child > div");
  const surface = await surfaceColors(panel);
  expect(surface.background, "панель остаётся тёмной, без старой бумажной заливки").toBeLessThan(.1);
  expect(surface.contrast).toBeGreaterThanOrEqual(4.5);
  expect(surface.font).toContain("Manrope");
  expect(surface.radius).toBeGreaterThanOrEqual(12);
  const email = page.getByLabel("Email");
  expect((await surfaceColors(email)).contrast).toBeGreaterThanOrEqual(4.5);
  await email.focus();
  expect(await email.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  for (const [width, height] of [[1280,720],[1440,600],[960,768],[1440,1100],[390,844]]) {
    await page.setViewportSize({ width, height });
    const layout=await page.locator('.auth-visual').evaluate(el=>{
      const copy=el.children[1]!.getBoundingClientRect();
      const city=el.querySelector<HTMLElement>('.auth-world')!;
      return { cityShown:getComputedStyle(city).display!=='none',cityTop:city.getBoundingClientRect().top,copyBottom:copy.bottom };
    });
    await page.screenshot({ path:info.outputPath(`auth-layout-${width}-${height}.png`) });
    if(layout.cityShown)expect(layout.cityTop,`${width}x${height}: decorative city must remain below readable copy`).toBeGreaterThanOrEqual(layout.copyBottom+12);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
