import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import { z } from "zod";
import {
  openAuthorizedImage,
  resolveAuthorizedImagePath,
} from "./image-access.js";
import { agentLog } from "./logger.js";

const DEFAULT_MAX_IMAGE_BYTES = 16 * 1024 * 1024;

// Base64 encoding plus JSON serialization holds several copies of the image in
// memory at once, so an unbounded read can stall or kill the server.
function configuredMaxImageBytes(rawValue = process.env.MCP_IMAGE_MAX_BYTES) {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_MAX_IMAGE_BYTES;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError("MCP_IMAGE_MAX_BYTES must be a positive integer.");
  }
  return parsed;
}

const MAX_IMAGE_BYTES = configuredMaxImageBytes();

const ReadLocalImageArgsSchema = z.object({
  // trim() is deliberate: model-supplied paths routinely carry stray
  // whitespace. Filenames whose own leading/trailing spaces are significant
  // are not addressable through this tool.
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
    // Must stay in step with ReadLocalImageArgsSchema: a request this schema
    // accepts has to be one the runtime accepts too.
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          minLength: 1,
          pattern: "\\S",
          description: "An absolute path, a working-directory-relative path, or a filename to search for recursively within authorized roots (jpg, png, webp). Surrounding whitespace is trimmed."
        }
      },
      required: ["filePath"],
      additionalProperties: false
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  agentLog.error(`[Agent] Executing: ${name}`);

  switch (name) {
    case "read_local_image": {
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

        // Inspect and read through one handle so the authorized file cannot be
        // swapped out between the checks and the read.
        const handle = await openAuthorizedImage(absolutePath);

        try {
          const stats = await handle.stat();
          if (!stats.isFile()) throw new Error("Path is not a file.");

          if (stats.size > MAX_IMAGE_BYTES) {
            throw new Error(
              `Image is ${stats.size.toLocaleString("en-US")} bytes, above the ${MAX_IMAGE_BYTES.toLocaleString("en-US")} byte limit. Resize the image or raise MCP_IMAGE_MAX_BYTES.`,
            );
          }

          const ext = path.extname(absolutePath).toLowerCase();
          const validExts = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

          if (!validExts[ext]) {
            throw new Error(`Unsupported format: ${ext}. Use PNG, JPG, or WebP.`);
          }

          // Read file and convert to Base64
          const buffer = await handle.readFile();
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
        } finally {
          await handle.close();
        }
      } catch (err) {
        agentLog.error("Failed to read image", err);
        return {
          content: [{ type: "text", text: `Error reading image: ${err.message}` }],
          isError: true
        };
      }
    }

    default:
      // An unknown tool name is a caller fault, not a server failure; a plain
      // Error would surface as InternalError (-32603).
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
agentLog.error("MCP Server is Active.");
