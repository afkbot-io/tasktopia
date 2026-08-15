import { join } from "node:path";
import { ASSET_REVISION } from "../shared/catalog";
import { synchronizeAssetRevision } from "./asset-revisions";

const gameAssetRoot = join(process.cwd(), "dist/public/game-assets/v5");
const revisionRoot = join(gameAssetRoot, "revisions");
await synchronizeAssetRevision(gameAssetRoot, revisionRoot, ASSET_REVISION);
process.stdout.write(`${ASSET_REVISION}\n`);
