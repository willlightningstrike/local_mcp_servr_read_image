import fs from "node:fs/promises";
import path from "node:path";

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function configuredRoots(cwd, additionalRoots) {
  return [
    cwd,
    ...additionalRoots
      .split(path.delimiter)
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => path.resolve(cwd, root)),
  ];
}

export async function resolveAuthorizedImagePath(
  filePath,
  {
    cwd = process.cwd(),
    additionalRoots = process.env.MCP_IMAGE_ALLOWED_ROOTS ?? "",
  } = {},
) {
  const roots = configuredRoots(cwd, additionalRoots);
  const [target, ...canonicalRoots] = await Promise.all([
    fs.realpath(path.resolve(cwd, filePath)),
    ...roots.map((root) => fs.realpath(root)),
  ]);

  if (!canonicalRoots.some((root) => isWithinRoot(root, target))) {
    throw new Error("Access denied: image path is outside allowed roots.");
  }

  return target;
}
