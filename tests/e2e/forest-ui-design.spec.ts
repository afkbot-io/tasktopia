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
  const panel = page.locator(".auth-panel");
  const surface = await surfaceColors(panel);
  expect(surface.background, "панель остаётся тёмной, без старой бумажной заливки").toBeLessThan(.1);
  expect(surface.contrast).toBeGreaterThanOrEqual(4.5);
  expect(surface.font).toContain("Manrope");
  expect(surface.radius).toBeGreaterThanOrEqual(12);
  expect(await panel.evaluate(el => getComputedStyle(el).borderRadius)).toBe(await panel.evaluate(el => getComputedStyle(el).getPropertyValue('--ui-radius-panel').trim()));
  const scene=page.locator('.auth-city-scene');await expect(scene).toHaveAttribute('data-scene-state','ready');
  expect(await scene.evaluate(el=>getComputedStyle(el).imageRendering)).toBe('pixelated');
  const email = page.getByLabel("Email");
  expect((await surfaceColors(email)).contrast).toBeGreaterThanOrEqual(4.5);
  await email.focus();
  expect(await email.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  for (const [width, height] of [[1280,681],[1280,901],[1023,681],[1024,681],[1024,901],[1280,720],[1440,600],[960,768],[1440,1001],[1440,1100],[390,844],[320,568],[1024,480],[1280,480],[1440,480]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({path:info.outputPath(`auth-layout-${width}-${height}.png`)});
    const scale=Number(await scene.getAttribute('data-pixel-scale'));
    expect([1,2]).toContain(scale);
    expect(await scene.evaluate((el:HTMLCanvasElement)=>el.clientWidth/el.width)).toBe(scale);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const submit=page.getByRole("button",{name:"Открыть страну",exact:true});
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
  }
});

test('восстановление доступа прокручивается внутри экрана и сохраняет игровую рамку на коротком телефоне', async ({page},info) => {
  await page.setViewportSize({width:320,height:568});await page.goto('/');
  await page.getByRole('button',{name:'Забыли пароль?'}).click();
  for(const [width,height] of [[320,568],[390,844],[768,600],[1440,480]]){
    await page.setViewportSize({width,height});
    expect(await page.locator('.auth-screen').evaluate(el=>el.clientHeight<=innerHeight),'форма должна прокручиваться внутри viewport, а не обрезаться root').toBe(true);
    const title=page.getByRole('heading',{name:'Вернуться в свой мир'});await title.scrollIntoViewIfNeeded();await expect(title).toBeInViewport();
    const back=page.getByRole('button',{name:'Вернуться ко входу'});await back.scrollIntoViewIfNeeded();await expect(back).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`recovery-${width}-${height}.png`)});
  }
});
