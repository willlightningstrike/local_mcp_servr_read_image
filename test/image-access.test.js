import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAuthorizedImagePath } from "../image-access.js";

async function withFixture(run) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-image-access-"));
  const allowed = path.join(base, "allowed");
  const additional = path.join(base, "additional");
  const outside = path.join(base, "outside");
  await Promise.all([
    fs.mkdir(allowed),
    fs.mkdir(additional),
    fs.mkdir(outside),
  ]);

  try {
    await run({ allowed, additional, outside });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

test("authorizes an image under the current working directory", async () => {
  await withFixture(async ({ allowed }) => {
    const image = path.join(allowed, "inside.png");
    await fs.writeFile(image, "inside");
    assert.equal(
      await resolveAuthorizedImagePath(image, { cwd: allowed }),
      await fs.realpath(image),
    );
  });
});

test("authorizes an image under an additional root", async () => {
  await withFixture(async ({ allowed, additional }) => {
    const image = path.join(additional, "additional.jpg");
    await fs.writeFile(image, "additional");
    assert.equal(
      await resolveAuthorizedImagePath(image, {
        cwd: allowed,
        additionalRoots: additional,
      }),
      await fs.realpath(image),
    );
  });
});

test("rejects an image outside every allowed root", async () => {
  await withFixture(async ({ allowed, outside }) => {
    const image = path.join(outside, "outside.webp");
    await fs.writeFile(image, "outside");
    await assert.rejects(
      resolveAuthorizedImagePath(image, { cwd: allowed }),
      /Access denied: image path is outside allowed roots/,
    );
  });
});

test("rejects a symlink that escapes an allowed root", async () => {
  await withFixture(async ({ allowed, outside }) => {
    const image = path.join(outside, "secret.png");
    const link = path.join(allowed, "linked.png");
    await fs.writeFile(image, "secret");
    await fs.symlink(image, link);
    await assert.rejects(
      resolveAuthorizedImagePath(link, { cwd: allowed }),
      /Access denied: image path is outside allowed roots/,
    );
  });
});

test("authorizes an exact filename in the current working directory", async () => {
  await withFixture(async ({ allowed }) => {
    const image = path.join(allowed, "inside.png");
    await fs.writeFile(image, "inside");

    assert.equal(
      await resolveAuthorizedImagePath("inside.png", { cwd: allowed }),
      await fs.realpath(image),
    );
  });
});

test("finds a unique nested filename in the current working directory", async () => {
  await withFixture(async ({ allowed }) => {
    const nested = path.join(allowed, "nested");
    const image = path.join(nested, "diagram.png");
    await fs.mkdir(nested);
    await fs.writeFile(image, "diagram");

    assert.equal(
      await resolveAuthorizedImagePath("diagram.png", { cwd: allowed }),
      await fs.realpath(image),
    );
  });
});

test("finds a unique filename in an additional root", async () => {
  await withFixture(async ({ allowed, additional }) => {
    const nested = path.join(additional, "nested");
    const image = path.join(nested, "additional.png");
    await fs.mkdir(nested);
    await fs.writeFile(image, "additional");

    assert.equal(
      await resolveAuthorizedImagePath("additional.png", {
        cwd: allowed,
        additionalRoots: additional,
      }),
      await fs.realpath(image),
    );
  });
});

test("prefers an exact current-directory filename over nested duplicates", async () => {
  await withFixture(async ({ allowed }) => {
    const nested = path.join(allowed, "nested");
    const exact = path.join(allowed, "same.png");
    await fs.mkdir(nested);
    await Promise.all([
      fs.writeFile(exact, "exact"),
      fs.writeFile(path.join(nested, "same.png"), "nested"),
    ]);

    assert.equal(
      await resolveAuthorizedImagePath("same.png", { cwd: allowed }),
      await fs.realpath(exact),
    );
  });
});

test("does not search for a relative path containing directories", async () => {
  await withFixture(async ({ allowed }) => {
    const nested = path.join(allowed, "elsewhere");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, "image.png"), "image");

    await assert.rejects(
      resolveAuthorizedImagePath(path.join("missing", "image.png"), {
        cwd: allowed,
      }),
      (error) =>
        ["ENOENT", "ENOTDIR"].includes(error.code) &&
        !error.message.includes("Image file not found in authorized roots"),
    );
  });
});

test("rejects an ambiguous recursive filename with sorted matches", async () => {
  await withFixture(async ({ allowed }) => {
    const firstDir = path.join(allowed, "a");
    const secondDir = path.join(allowed, "b");
    const first = path.join(firstDir, "duplicate.png");
    const second = path.join(secondDir, "duplicate.png");
    await Promise.all([fs.mkdir(firstDir), fs.mkdir(secondDir)]);
    await Promise.all([
      fs.writeFile(first, "first"),
      fs.writeFile(second, "second"),
    ]);

    await assert.rejects(
      resolveAuthorizedImagePath("duplicate.png", { cwd: allowed }),
      (error) =>
        error.message.includes('Ambiguous image filename "duplicate.png"') &&
        error.message.indexOf(first) < error.message.indexOf(second) &&
        error.message.includes("Retry with an exact path."),
    );
  });
});

test("limits ambiguity output to 10 sorted paths", async () => {
  await withFixture(async ({ allowed }) => {
    for (let index = 0; index < 11; index += 1) {
      const directory = path.join(allowed, String(index).padStart(2, "0"));
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, "many.png"), String(index));
    }

    await assert.rejects(
      resolveAuthorizedImagePath("many.png", { cwd: allowed }),
      (error) => {
        const listedPaths = error.message
          .split("\n")
          .filter((line) => line.startsWith("- "));
        return listedPaths.length === 10 &&
          error.message.includes("... and 1 more match not shown.");
      },
    );
  });
});

test("returns a filename-specific not-found error", async () => {
  await withFixture(async ({ allowed }) => {
    await assert.rejects(
      resolveAuthorizedImagePath("missing.png", { cwd: allowed }),
      /Image file not found in authorized roots: missing\.png/,
    );
  });
});

test("does not traverse a symlinked directory", async () => {
  await withFixture(async ({ allowed, outside }) => {
    const image = path.join(outside, "hidden.png");
    await fs.writeFile(image, "hidden");
    await fs.symlink(outside, path.join(allowed, "linked-directory"));

    await assert.rejects(
      resolveAuthorizedImagePath("hidden.png", { cwd: allowed }),
      /Image file not found in authorized roots: hidden\.png/,
    );
  });
});

test("accepts a searched file symlink targeting an authorized file", async () => {
  await withFixture(async ({ allowed }) => {
    const targetDir = path.join(allowed, "targets");
    const linkDir = path.join(allowed, "links");
    const target = path.join(targetDir, "target.png");
    const link = path.join(linkDir, "linked.png");
    await Promise.all([fs.mkdir(targetDir), fs.mkdir(linkDir)]);
    await fs.writeFile(target, "target");
    await fs.symlink(target, link);

    assert.equal(
      await resolveAuthorizedImagePath("linked.png", { cwd: allowed }),
      await fs.realpath(target),
    );
  });
});

test("ignores a searched file symlink escaping authorized roots", async () => {
  await withFixture(async ({ allowed, outside }) => {
    const nested = path.join(allowed, "nested");
    const target = path.join(outside, "secret.png");
    await fs.mkdir(nested);
    await fs.writeFile(target, "secret");
    await fs.symlink(target, path.join(nested, "escaped.png"));

    await assert.rejects(
      resolveAuthorizedImagePath("escaped.png", { cwd: allowed }),
      /Image file not found in authorized roots: escaped\.png/,
    );
  });
});

test("deduplicates a canonical file found through overlapping roots", async () => {
  await withFixture(async ({ allowed }) => {
    const nestedRoot = path.join(allowed, "nested-root");
    const image = path.join(nestedRoot, "overlap.png");
    await fs.mkdir(nestedRoot);
    await fs.writeFile(image, "overlap");

    assert.equal(
      await resolveAuthorizedImagePath("overlap.png", {
        cwd: allowed,
        additionalRoots: nestedRoot,
      }),
      await fs.realpath(image),
    );
  });
});

test("stops recursive search at the configured entry limit", async () => {
  await withFixture(async ({ allowed }) => {
    await Promise.all([
      fs.writeFile(path.join(allowed, "a.txt"), "a"),
      fs.writeFile(path.join(allowed, "b.txt"), "b"),
      fs.writeFile(path.join(allowed, "c.txt"), "c"),
    ]);

    await assert.rejects(
      resolveAuthorizedImagePath("missing.png", {
        cwd: allowed,
        maxSearchEntries: 2,
      }),
      /Image search exceeded 2 directory entries/,
    );
  });
});

test("rejects invalid maximum search entry limits", async () => {
  await withFixture(async ({ allowed }) => {
    for (const maxSearchEntries of [NaN, Infinity, -Infinity, 0, -1, 1.5]) {
      await assert.rejects(
        resolveAuthorizedImagePath("missing.png", {
          cwd: allowed,
          maxSearchEntries,
        }),
        /maxSearchEntries must be a positive integer/,
      );
    }
  });
});
