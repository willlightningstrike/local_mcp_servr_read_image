import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const logPath = path.join(projectRoot, "mcp-server.log");

test("logger writes to mcp-server.log", async () => {
  const marker = `logger transport test ${randomUUID()}`;
  const script = `
    import { logger } from "./logger.js";
    logger.info(process.env.LOG_MARKER);
    await new Promise((resolve, reject) => {
      logger.flush((error) => error ? reject(error) : resolve());
    });
  `;

  await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: projectRoot,
    env: { ...process.env, LOG_MARKER: marker },
    timeout: 5000,
  });
  const contents = await fs.readFile(logPath, "utf8");
  assert.match(contents, new RegExp(marker));
});
