import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAssetRevision, synchronizeAssetRevision } from "../src/server/asset-revisions";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("asset revision storage", () => {
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
});
