import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const REVISION_PATTERN = /^[a-f0-9]{16}$/;

export function isAssetRevision(value: string): boolean {
  return REVISION_PATTERN.test(value);
}

export async function synchronizeAssetRevision(
  assetRoot: string,
  revisionRoot: string,
  revision: string,
  retainedRevisions = 3,
): Promise<string> {
  if (!isAssetRevision(revision)) throw new Error(`Invalid asset revision: ${revision}`);
  if (!Number.isInteger(retainedRevisions) || retainedRevisions < 2) {
    throw new Error("At least two asset revisions must be retained");
  }

  await mkdir(revisionRoot, { recursive: true });
  const destination = join(revisionRoot, revision);
  try {
    await stat(destination);
  } catch {
    const temporary = join(revisionRoot, `.${revision}-${process.pid}-${Date.now()}`);
    await mkdir(temporary, { recursive: true });
    try {
      for (const entry of await readdir(assetRoot, { withFileTypes: true })) {
        if (entry.name === basename(revisionRoot)) continue;
        await cp(join(assetRoot, entry.name), join(temporary, entry.name), { recursive: entry.isDirectory() });
      }
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  const revisions = (await readdir(revisionRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && isAssetRevision(entry.name))
    .map(async (entry) => ({ name: entry.name, modifiedAt: (await stat(join(revisionRoot, entry.name))).mtimeMs }));
  const ordered = (await Promise.all(revisions)).sort((left, right) => {
    if (left.name === revision) return -1;
    if (right.name === revision) return 1;
    return right.modifiedAt - left.modifiedAt;
  });
  const stale = ordered.slice(retainedRevisions);
  await Promise.all(stale.map((entry) => rm(join(revisionRoot, entry.name), { recursive: true, force: true })));
  return destination;
}
