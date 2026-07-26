import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { resolveAuthorizedImagePath } from "./image-access.js";
import { agentLog } from "./logger.js";

const ReadLocalImageArgsSchema = z.object({
  filePath: z.string().trim().min(1),
}).strict();

const server = new Server({
  name: "mac-expert-agent",
  version: "2.0.0",
}, {
  capabilities: { tools: {} },
});

// --- TOOL DEFINITIONS ---
const TOOLS = [
  {
    name: "read_local_image",
    description: "Reads a local image file and provides it to the AI for visual analysis.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The absolute path to the image file (jpg, png, webp)."
        }
      },
      required: ["filePath"]
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  agentLog.error(`[Agent] Executing: ${name}`);

  switch (name) {
    case "read_local_image":
      const parsedArgs = ReadLocalImageArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid arguments for read_local_image",
        );
      }
      const { filePath } = parsedArgs.data;

      try {
        const absolutePath = await resolveAuthorizedImagePath(filePath);
        agentLog.info("Reading local image", { path: absolutePath });

        // Check if file exists and is an image
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) throw new Error("Path is not a file.");

        const ext = path.extname(absolutePath).toLowerCase();
        const validExts = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

        if (!validExts[ext]) {
          throw new Error(`Unsupported format: ${ext}. Use PNG, JPG, or WebP.`);
        }

        // Read file and convert to Base64
        const buffer = await fs.readFile(absolutePath);
        const base64Image = buffer.toString('base64');

        return {
          content: [
            {
              type: "text",
              text: `Image loaded: ${path.basename(absolutePath)}. You can now see this image.`
            },
            {
              type: "image",
              data: base64Image,
              mimeType: validExts[ext]
            }
          ]
        };
      } catch (err) {
        agentLog.error("Failed to read image", err);
        return {
          content: [{ type: "text", text: `Error reading image: ${err.message}` }],
          isError: true
        };
      }

    default:
      throw new Error("Tool not found");
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
agentLog.error("MCP Server is Active.");
