// Maintenance CLI: apply registered migrations without generating or repairing worlds.
import { createDb } from "./db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = await createDb(url, { maxConnections: 1 });
  await db.close();
  console.log(JSON.stringify({ event: "world-migration.finished" }));
}

main().catch(() => { console.error("World migration failed"); process.exitCode = 1; });
