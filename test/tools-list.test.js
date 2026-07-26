import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

test("tools/list exposes only read_local_image", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "tool-list-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(result.tools.map(({ name }) => name), ["read_local_image"]);
  } finally {
    await client.close();
  }
});

test("read_local_image rejects a file outside the server working directory", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-image-tool-"));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  const serverEntry = path.join(process.cwd(), "index.js");
  await Promise.all([fs.mkdir(allowed), fs.mkdir(outside)]);
  const image = path.join(outside, "secret.png");
  await fs.writeFile(image, "secret");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: allowed,
  });
  const client = new Client({ name: "image-boundary-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "read_local_image",
      arguments: { filePath: image },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /outside allowed roots/);
  } finally {
    await client.close();
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("read_local_image rejects malformed arguments as InvalidParams", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "input-validation-test", version: "1.0.0" });
  const invalidRequests = [
    { name: "read_local_image" },
    { name: "read_local_image", arguments: { filePath: 42 } },
    { name: "read_local_image", arguments: { filePath: "   " } },
    {
      name: "read_local_image",
      arguments: { filePath: "image.png", unexpected: true },
    },
  ];

  try {
    await client.connect(transport);
    for (const request of invalidRequests) {
      await assert.rejects(
        client.callTool(request),
        (error) =>
          error.code === ErrorCode.InvalidParams &&
          error.message.includes("Invalid arguments for read_local_image"),
      );
    }
  } finally {
    await client.close();
  }
});
