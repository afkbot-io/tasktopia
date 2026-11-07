import type { TestInfo } from '@playwright/test';
import type { AppService } from '../../src/server/app-service';

/** Capture only after a failed assertion. The scene belongs to this isolated
 * fixture; reading it never changes browser actors, clocks or admission. */
export async function captureOwnedCityFailure(info: TestInfo, service: AppService, countryId: string, cityId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const scene = await Promise.race([service.getCityScene(countryId, cityId), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned failure scene exceeded2500ms')), 2500);
    })]);
    await info.attach('owned-city-scene-on-failure', { body: JSON.stringify(scene), contentType: 'application/json' });
  } catch { /* Preserve the original assertion when diagnostics are unavailable. */ }
  finally { if (timer) clearTimeout(timer); }
}
