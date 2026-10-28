import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../shared/city-scene-contract";
import { createCitySceneRefresh } from "./city-scene-deadline";
import { loadCitySceneResponse } from "./city-scene-response";
import { loadCityScene, retainCityScene } from "./map-scene-cache";

/** The mounted canvas owns refresh cancellation and publication together. */
export class RetainedCitySceneRefresh {
  private readonly refresh = createCitySceneRefresh();
  private disposed = false;
  private release: (() => void) | undefined;

  constructor(private readonly countryId: string, private readonly cityId: string,
    private readonly revision: number, private readonly onCommitted?: (scene: CitySceneDto) => void) {}

  commit(scene: CitySceneDto): void {
    if (this.disposed) return;
    const release = retainCityScene(scene);
    this.release?.(); this.release = release;
    this.onCommitted?.(scene);
  }

  request(install: (scene: CitySceneDto) => void | false,
    load = (signal: AbortSignal) => loadCitySceneResponse(`/api/countries/${this.countryId}/cities/${this.cityId}/scene`, signal)): Promise<void> {
    return this.refresh.request(async signal => {
      const scene = await loadCityScene(this.countryId, this.cityId, this.revision, true, async () => {
        if (this.disposed || signal.aborted) throw new DOMException("Map refresh cancelled", "AbortError");
        const scene = await load(signal);
        if (this.disposed || signal.aborted) throw new DOMException("Map refresh cancelled", "AbortError");
        return scene;
      });
      if (this.disposed || signal.aborted) return;
      if (scene.schemaVersion !== CITY_SCENE_SCHEMA_VERSION || scene.city.id !== this.cityId || scene.lod !== "DETAIL") {
        throw new Error("Сервер вернул несовместимую сцену города");
      }
      if (install(scene) !== false) this.commit(scene);
    });
  }

  cancel(): void { this.refresh.cancel(); }
  dispose(): void { this.disposed = true; this.refresh.dispose(); this.release?.(); this.release = undefined; }
}
