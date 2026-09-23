import { expect, type Page } from '@playwright/test';

/** Map destinations are contextual: city entry lives on the planet itself. */
export async function openMapCity(page: Page) {
  const planet = page.locator('.planet-atlas');
  const city = page.getByRole('navigation', { name: 'Уровень карты' }).getByRole('button', { name: 'Город', exact: true });
  await expect(planet.or(city)).toBeVisible({ timeout: 30_000 });
  if (await planet.isVisible()) {
    await expect(planet).toHaveAttribute('data-planet-ready', 'true');
    const bootstrap = await (await page.request.get('/api/bootstrap')).json();
    const target = page.locator(`.planet-city-targets [data-city-id="${bootstrap.initialCity.id}"]`);
    await target.focus();
    await page.keyboard.press('Enter');
  } else await city.click();
}

export async function openMapPlanet(page: Page) {
  const planet = page.locator('.planet-atlas');
  const button = page.getByRole('navigation', { name: 'Уровень карты' }).getByRole('button', { name: 'Планета', exact: true });
  await expect(planet.or(button)).toBeVisible({ timeout: 30_000 });
  if (!await planet.isVisible()) await button.click();
}
