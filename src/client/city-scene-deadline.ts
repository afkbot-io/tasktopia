import { BoundedMapRefresh } from "./bounded-map-refresh";
import { loadMapWithTimeout } from "./map-load-timeout";

export const CITY_SCENE_LOAD_TIMEOUT_MS=30_000;
export function loadCitySceneWithTimeout<T>(load:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  return loadMapWithTimeout(load,CITY_SCENE_LOAD_TIMEOUT_MS);
}
export const createCitySceneRefresh=()=>new BoundedMapRefresh(CITY_SCENE_LOAD_TIMEOUT_MS);
