import type { RealtimeEvent } from "../shared/contracts";
import type { Db } from "./db";

/** Only a refresh hint leaves the source country. No task fields or route data. */
export async function foreignTransportRecipients(db: Db, event: RealtimeEvent): Promise<string[]> {
  const relevant = event.payload.serviceRole === "AIRPORT" || event.payload.serviceRole === "RAILWAY" || event.payload.serviceRole === "PORT"
    || ["task.deleted", "task.transferred", "city.deleted", "city.renamed", "district.deleted", "country.regenerated"].includes(event.type);
  if (!relevant) return [];
  const rows = await db.prepare("SELECT user_id FROM country_members WHERE country_id=?").all<{user_id:string}>(event.countryId);
  return rows.map(row=>row.user_id);
}
