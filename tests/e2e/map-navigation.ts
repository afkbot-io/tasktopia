import { expect, type Page } from '@playwright/test';

/** Map destinations are contextual: city entry lives on the planet itself. */
export async function openMapCity(page: Page) {
  const planet = page.locator('.planet-atlas');
  const city = page.getByRole('navigation', { name: 'Уровень карты' }).getByRole('button', { name: 'Город', exact: true });
  const requested = new URL(page.url()), requestedCity = requested.searchParams.get('cityId');
  if (requestedCity) {
    // Reload restores this explicit destination asynchronously. Its temporary
    // PLANET can disappear before its assets are ready; do not navigate again.
    const requestedCountry = requested.searchParams.get('countryId');
    await expect(city).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const current = new URL(page.url());
      return current.origin === requested.origin && current.searchParams.get('cityId') === requestedCity
        && (!requestedCountry || current.searchParams.get('countryId') === requestedCountry)
        && await city.isVisible() && await page.locator('.world-canvas').isVisible();
    }, { message: 'The requested CITY context must own the visible map; terrain readiness belongs to the caller' }).toBe(true);
    return;
  }
  await expect(planet.or(city)).toBeVisible({ timeout: 30_000 });
  if (await planet.isVisible()) {
    await expect(planet).toHaveAttribute('data-planet-ready', 'true');
    const response = await page.request.get('/api/bootstrap');
    expect(response.status(), 'Map navigation requires a successful bootstrap').toBe(200);
    const bootstrap = await response.json();
    expect(bootstrap.initialCity?.id, 'Map navigation requires a fixture city').toBeTruthy();
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
