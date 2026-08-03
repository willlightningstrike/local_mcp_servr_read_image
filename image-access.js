import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_SEARCH_ENTRIES = 10_000;
const MAX_REPORTED_MATCHES = 10;

function compareOrdinal(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

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

function isAuthorized(canonicalRoots, target) {
  return canonicalRoots.some((root) => isWithinRoot(root, target));
}

function authorize(canonicalRoots, target) {
  if (!isAuthorized(canonicalRoots, target)) {
    throw new Error("Access denied: image path is outside allowed roots.");
  }
  return target;
}

function isMissingPathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function isFilenameOnly(filePath) {
  return !path.isAbsolute(filePath) &&
    path.basename(filePath) === filePath &&
    filePath !== "." &&
    filePath !== "..";
}

function validateMaxSearchEntries(maxSearchEntries) {
  if (!Number.isInteger(maxSearchEntries) || maxSearchEntries <= 0) {
    throw new TypeError("maxSearchEntries must be a positive integer.");
  }
}

function ambiguityError(fileName, matches) {
  const shown = matches.slice(0, MAX_REPORTED_MATCHES);
  const omitted = matches.length - shown.length;
  const lines = [
    `Ambiguous image filename "${fileName}": ${matches.length} matches found in authorized roots.`,
    ...shown.map((match) => `- ${match}`),
  ];

  if (omitted > 0) {
    lines.push(`... and ${omitted} more ${omitted === 1 ? "match" : "matches"} not shown.`);
  }

  lines.push("Retry with an exact path.");
  return new Error(lines.join("\n"));
}

async function findAuthorizedImageByName(
  fileName,
  canonicalRoots,
  maxSearchEntries,
) {
  const pendingDirectories = [...canonicalRoots].reverse();
  const visitedDirectories = new Set();
  const matches = new Set();
  let inspectedEntries = 0;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();

    // A directory can disappear between being queued and being opened; that is
    // a normal concurrent-filesystem event, not a failure of the whole search.
    let canonicalDirectory;
    let directory;
    try {
      canonicalDirectory = await fs.realpath(currentDirectory);
      if (
        visitedDirectories.has(canonicalDirectory) ||
        !isAuthorized(canonicalRoots, canonicalDirectory)
      ) {
        continue;
      }
      directory = await fs.opendir(canonicalDirectory);
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }
      throw error;
    }
    visitedDirectories.add(canonicalDirectory);

    const entries = [];
    for await (const entry of directory) {
      inspectedEntries += 1;
      if (inspectedEntries > maxSearchEntries) {
        throw new Error(
          `Image search exceeded ${maxSearchEntries.toLocaleString("en-US")} directory entries. Provide a more specific path or configure a narrower authorized root.`,
        );
      }
      entries.push(entry);
    }
    entries.sort((left, right) => compareOrdinal(left.name, right.name));

    const childDirectories = [];
    for (const entry of entries) {
      const candidate = path.join(canonicalDirectory, entry.name);
      if (entry.isDirectory()) {
        childDirectories.push(candidate);
        continue;
      }
      if (
        entry.name !== fileName ||
        (!entry.isFile() && !entry.isSymbolicLink())
      ) {
        continue;
      }

      try {
        const canonicalCandidate = await fs.realpath(candidate);
        const stats = await fs.stat(canonicalCandidate);
        if (
          stats.isFile() &&
          isAuthorized(canonicalRoots, canonicalCandidate)
        ) {
          matches.add(canonicalCandidate);
        }
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
    }

    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      pendingDirectories.push(childDirectories[index]);
    }
  }

  return [...matches].sort(compareOrdinal);
}

export async function resolveAuthorizedImagePath(
  filePath,
  {
    cwd = process.cwd(),
    additionalRoots = process.env.MCP_IMAGE_ALLOWED_ROOTS ?? "",
    maxSearchEntries = DEFAULT_MAX_SEARCH_ENTRIES,
  } = {},
) {
  validateMaxSearchEntries(maxSearchEntries);

  const canonicalRoots = await Promise.all(
    configuredRoots(cwd, additionalRoots).map((root) => fs.realpath(root)),
  );

  try {
    const target = await fs.realpath(path.resolve(cwd, filePath));
    // A directory named like the requested image must not shadow a real
    // nested image of the same name; fall through to the recursive search.
    const targetStats = await fs.stat(target);
    if (targetStats.isFile() || !isFilenameOnly(filePath)) {
      return authorize(canonicalRoots, target);
    }
  } catch (error) {
    if (!isMissingPathError(error) || !isFilenameOnly(filePath)) {
      throw error;
    }
  }

  const matches = await findAuthorizedImageByName(
    filePath,
    canonicalRoots,
    maxSearchEntries,
  );

  if (matches.length === 0) {
    throw new Error(`Image file not found in authorized roots: ${filePath}`);
  }
  if (matches.length > 1) {
    throw ambiguityError(filePath, matches);
  }
  return matches[0];
}
