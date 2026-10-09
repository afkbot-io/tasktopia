import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAssetRevision, synchronizeAssetRevision } from "../src/server/asset-revisions";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("asset revision storage", () => {
  it("publishes one complete revision during concurrent starts and clears private staging directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "tasktopia-assets-concurrent-")); temporaryRoots.push(root);
    const assets = join(root, "v5"), revisions = join(assets, "revisions");
    await mkdir(join(assets, "props"), { recursive: true });
    for (let i = 0; i < 12; i++) await writeFile(join(assets, `props/${i}.png`), `sprite-${i}`.repeat(1000));
    for (const [i, revision] of ['1111111111111111', '2222222222222222', '3333333333333333'].entries()) {
      await mkdir(join(revisions, revision), { recursive: true });
      await writeFile(join(revisions, revision, 'marker'), revision);
      await utimes(join(revisions, revision), i + 1, i + 1);
    }
    const revision = '4444444444444444';
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => synchronizeAssetRevision(assets, revisions, revision)));
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect((await stat(join(revisions, revision))).mode & 0o777).toBe(0o755);
    for (let i = 0; i < 12; i++) expect(await readFile(join(revisions, revision, `props/${i}.png`), 'utf8')).toBe(`sprite-${i}`.repeat(1000));
    expect((await readdir(revisions)).sort()).toEqual(['2222222222222222', '3333333333333333', revision]);
  });

  it("copies the current pack and retains older physical revisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "tasktopia-assets-"));
    temporaryRoots.push(root);
    const assets = join(root, "v4");
    const revisions = join(assets, "revisions");
    await mkdir(join(assets, "props"), { recursive: true });
    await writeFile(join(assets, "props/tree.png"), "current");

    for (const [index, revision] of ["1111111111111111", "2222222222222222", "3333333333333333"].entries()) {
      const path = join(revisions, revision);
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "marker"), revision);
      await utimes(path, index + 1, index + 1);
    }

    const current = "4444444444444444";
    await synchronizeAssetRevision(assets, revisions, current, 3);

    expect(await readFile(join(revisions, current, "props/tree.png"), "utf8")).toBe("current");
    expect((await readdir(revisions)).sort()).toEqual([
      "2222222222222222",
      "3333333333333333",
      current,
    ]);
  });

  it("accepts only canonical content revisions", () => {
    expect(isAssetRevision("a1b2c3d4e5f67890")).toBe(true);
    expect(isAssetRevision("../a1b2c3d4e5f67890")).toBe(false);
    expect(isAssetRevision("latest")).toBe(false);
  });

  it("does not publish an incomplete revision or leak staging after a copy failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "tasktopia-assets-failure-")); temporaryRoots.push(root);
    const revisions = join(root, 'revisions');
    await expect(synchronizeAssetRevision(join(root, 'missing'), revisions, '4444444444444444')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(revisions)).toEqual([]);
  });
});
