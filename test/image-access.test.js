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
