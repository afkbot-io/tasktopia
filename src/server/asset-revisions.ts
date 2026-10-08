import { chmod, cp, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
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
    const temporary = await mkdtemp(join(revisionRoot, `.${revision}-${process.pid}-`));
    try {
      for (const entry of await readdir(assetRoot, { withFileTypes: true })) {
        if (entry.name === basename(revisionRoot)) continue;
        await cp(join(assetRoot, entry.name), join(temporary, entry.name), { recursive: entry.isDirectory() });
      }
      // mkdtemp is private (0700); published assets must remain readable by
      // the independent static server after a filesystem export.
      await chmod(temporary, 0o755);
      try {
        await rename(temporary, destination);
      } catch (error) {
        // Another publisher can atomically finish the same immutable revision
        // first. POSIX reports either EEXIST or ENOTEMPTY for that race.
        if (!(error instanceof Error) || !('code' in error)
          || !['EEXIST', 'ENOTEMPTY'].includes(String(error.code))) throw error;
        if (!(await stat(destination)).isDirectory()) throw error;
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  const revisions = (await readdir(revisionRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && isAssetRevision(entry.name))
    .map(async (entry) => {
      try { return { name: entry.name, modifiedAt: (await stat(join(revisionRoot, entry.name))).mtimeMs }; }
      catch (error) {
        // A concurrent publisher may already have pruned this older revision.
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw error;
      }
    });
  const ordered = (await Promise.all(revisions)).filter(entry => entry !== undefined).sort((left, right) => {
    if (left.name === revision) return -1;
    if (right.name === revision) return 1;
    return right.modifiedAt - left.modifiedAt;
  });
  const stale = ordered.slice(retainedRevisions);
  await Promise.all(stale.map((entry) => rm(join(revisionRoot, entry.name), { recursive: true, force: true })));
  return destination;
}
