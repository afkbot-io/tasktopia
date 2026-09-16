import type { PlanetAtlasDto } from "../shared/planet-atlas-contract";
import { extendPersonalPlanet, importPersonalPlanet, type PersonalPlanetGeography } from "../shared/planet-geography";
import { transaction, type Db } from "./db";

/** User-row lock serializes first import and extension across server replicas.
 * No active world/task geometry is rewritten; failure rolls back the reserve. */
export async function readOrExtendPersonalPlanet(db: Db, userId: string, atlas: PlanetAtlasDto): Promise<PersonalPlanetGeography> {
  return transaction(db, async () => {
    const owner = await db.prepare("SELECT id FROM users WHERE id=? FOR UPDATE").get(userId);
    if (!owner) throw new Error("Planet owner no longer exists");
    const row = await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?")
      .get<{geography_json:PersonalPlanetGeography}>(userId);
    const previous = row?.geography_json;
    if (previous && atlas.countries.every(country => {
      const stored=previous.countries[country.id];
      return stored && country.cities.every(city=>Boolean(stored.cities[city.id]));
    })) return previous;
    const next = previous ? extendPersonalPlanet(previous,atlas) : importPersonalPlanet(atlas);
    await db.prepare(`INSERT INTO personal_planet_geography_v1(user_id,geography_json) VALUES (?,?::jsonb)
      ON CONFLICT(user_id) DO UPDATE SET geography_json=EXCLUDED.geography_json,updated_at=now()`)
      .run(userId,JSON.stringify(next));
    return next;
  });
}
