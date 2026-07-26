# Local Image MCP Server

A small local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
server that lets an MCP client load an image from an explicitly allowed local
directory.

The server uses the MCP `stdio` transport. It does not open a network port and
currently exposes one read-only tool: `read_local_image`.

## What it does

This server:

- Loads a local PNG, JPEG, or WebP file from an allowed directory.
- Returns the image to the MCP client, where a vision-capable model can inspect
  or discuss it.
- Rejects paths outside the configured roots, including symlink escapes.
- Validates tool arguments before using them.
- Writes runtime diagnostics to `mcp-server.log`.

This server does **not** analyze images itself. The connected MCP client and
model perform the analysis. It also does not expose shell commands, web access,
directory listing, file writing, or deletion.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- npm, which is normally installed with Node.js
- A local MCP client that supports `stdio`
- A tool-capable model; image understanding also requires a vision-capable
  model

Find the absolute path to Node before configuring a GUI client:

```bash
# macOS or Linux
which node

# Windows Command Prompt
where node
```

GUI applications often receive a smaller `PATH` than a terminal, so an
absolute Node path is more reliable than `"node"`.

## Installation

```bash
git clone https://github.com/willlightningstrike/local_mcp_servr_read_image.git
cd local_mcp_servr_read_image
npm ci
npm test
```

`npm ci` installs the dependency versions recorded in `package-lock.json`.

## Run and test

To start the server directly:

```bash
node index.js
```

The process remains open because it is waiting for MCP JSON-RPC messages on
standard input. This is expected. In normal use, the MCP client starts and
stops the process for you.

Run the full test suite with:

```bash
npm test
```

## Available tools

### `read_local_image`

Loads one local image and returns a text acknowledgement plus MCP image
content.

| Field | Type | Required | Description |
|---|---|---:|---|
| `filePath` | string | Yes | Absolute path, working-directory-relative path, or filename to search for within authorized roots |

Supported filename extensions:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

Tool-call shape:

```json
{
  "name": "read_local_image",
  "arguments": {
    "filePath": "example.png"
  }
}
```

Malformed arguments return MCP `InvalidParams` (`-32602`). Path,
authorization, file-type, and filesystem failures return a tool result with
`isError: true`.

## Example

Place `diagram.png` inside the configured image directory, then ask the client:

> Use `read_local_image` to open `diagram.png`. Describe the diagram and list
> any text visible in it.

The client may ask you to approve the tool call. After approval, the server
reads the image and returns it to the client. Whether the model can interpret
the result depends on the client's MCP image support and the selected model's
vision capabilities.

## Filesystem access

The server always allows its canonical current working directory. It resolves
both roots and requested files to canonical paths before checking containment,
which blocks `..` traversal, path-prefix tricks, and symlinks that resolve
outside an allowed root.

When `filePath` is only a filename, the server checks the current working
directory first. If no exact file exists there, it searches recursively within
the current working directory and every configured additional root. Absolute
paths and relative paths containing directories are always resolved exactly
and never trigger filename search.

Search does not follow directory symlinks and never expands the configured
authorized roots. If multiple canonical files have the requested name, the
server returns an ambiguity error with up to 10 paths so the caller can retry
with an exact path. Search stops after 10,000 directory entries; configure a
narrower root or provide a more specific path if that limit is reached.

Additional roots are optional:

```bash
# macOS or Linux: separate multiple roots with :
MCP_IMAGE_ALLOWED_ROOTS="/path/to/screenshots:/path/to/diagrams" node index.js

# Windows Command Prompt: separate multiple roots with ;
set "MCP_IMAGE_ALLOWED_ROOTS=C:\Images;D:\Screenshots"
node index.js
```

`MCP_IMAGE_ALLOWED_ROOTS` is additive: it adds roots but does not remove the
default current-working-directory root. Set a narrow working directory when
launching the server. Do not start it from `/`, a home directory, or another
broad location unless you intend to make that entire tree eligible for image
reads.

Relative entries in `MCP_IMAGE_ALLOWED_ROOTS` are resolved from the server's
working directory. Absolute entries are easier to audit and are recommended.

## MCP client configuration

Replace every `/ABSOLUTE/PATH/...` value below. Paths to Node, `index.js`, and
allowed image directories must exist on the machine running the MCP client.
The `env` entries are optional; remove `MCP_IMAGE_ALLOWED_ROOTS` when you do
not need additional roots. Every configured additional root must already
exist.

The examples are POSIX-oriented. In JSON on Windows, either use forward
slashes or escape each backslash as `\\`.

### Generic stdio

An MCP host that accepts process-launch fields can use:

```json
{
  "command": "/ABSOLUTE/PATH/TO/NODE",
  "args": [
    "/ABSOLUTE/PATH/TO/REPOSITORY/index.js"
  ],
  "cwd": "/ABSOLUTE/PATH/TO/ALLOWED_IMAGES",
  "env": {
    "MCP_IMAGE_ALLOWED_ROOTS": "/ABSOLUTE/PATH/TO/ADDITIONAL_IMAGES"
  }
}
```

The transport is standard MCP over `stdio`: protocol messages use standard
input and output, while diagnostics use standard error and
`mcp-server.log`.

### Claude Desktop

Open Claude Desktop, go to **Settings → Developer → Edit Config**, and edit
`claude_desktop_config.json`.

Common locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop's documented configuration does not provide a portable `cwd`
example. The following POSIX configuration deliberately changes into the
allowed directory before starting Node:

```json
{
  "mcpServers": {
    "local-image": {
      "command": "/bin/sh",
      "args": [
        "-lc",
        "cd '/ABSOLUTE/PATH/TO/ALLOWED_IMAGES' && exec '/ABSOLUTE/PATH/TO/NODE' '/ABSOLUTE/PATH/TO/REPOSITORY/index.js'"
      ],
      "env": {
        "MCP_IMAGE_ALLOWED_ROOTS": "/ABSOLUTE/PATH/TO/ADDITIONAL_IMAGES"
      }
    }
  }
}
```

On Windows, create a fixed launcher such as
`C:\MCP\start-local-image-mcp.cmd`:

```bat
@echo off
cd /d "C:\ABSOLUTE\PATH\TO\ALLOWED_IMAGES"
"C:\Program Files\nodejs\node.exe" "C:\ABSOLUTE\PATH\TO\REPOSITORY\index.js"
```

Then configure Claude Desktop with:

```json
{
  "mcpServers": {
    "local-image": {
      "command": "C:\\Windows\\System32\\cmd.exe",
      "args": [
        "/d",
        "/s",
        "/c",
        "C:\\MCP\\start-local-image-mcp.cmd"
      ],
      "env": {
        "MCP_IMAGE_ALLOWED_ROOTS": "D:\\AdditionalImages"
      }
    }
  }
}
```

Save the file and fully quit and restart Claude Desktop.

### Codex

Add this to `~/.codex/config.toml`, or to `.codex/config.toml` inside a trusted
project:

```toml
[mcp_servers.local_image]
command = "/ABSOLUTE/PATH/TO/NODE"
args = ["/ABSOLUTE/PATH/TO/REPOSITORY/index.js"]
cwd = "/ABSOLUTE/PATH/TO/ALLOWED_IMAGES"
enabled_tools = ["read_local_image"]
default_tools_approval_mode = "prompt"

[mcp_servers.local_image.env]
MCP_IMAGE_ALLOWED_ROOTS = "/ABSOLUTE/PATH/TO/ADDITIONAL_IMAGES"
```

You can also register the process from the command line:

```bash
codex mcp add local-image \
  --env MCP_IMAGE_ALLOWED_ROOTS=/ABSOLUTE/PATH/TO/ADDITIONAL_IMAGES \
  -- /ABSOLUTE/PATH/TO/NODE /ABSOLUTE/PATH/TO/REPOSITORY/index.js
```

The current `codex mcp add` command does not expose a `cwd` option. After using
it, edit the resulting `mcp_servers.local_image` table and add the narrow
`cwd` shown above. Confirm the server with:

```bash
codex mcp get local-image
codex mcp list
```

### Antigravity

Antigravity supports a global configuration at
`~/.gemini/config/mcp_config.json` and a workspace configuration at
`.agents/mcp_config.json`.

```json
{
  "mcpServers": {
    "local-image": {
      "command": "/ABSOLUTE/PATH/TO/NODE",
      "args": [
        "/ABSOLUTE/PATH/TO/REPOSITORY/index.js"
      ],
      "cwd": "/ABSOLUTE/PATH/TO/ALLOWED_IMAGES",
      "env": {
        "MCP_IMAGE_ALLOWED_ROOTS": "/ABSOLUTE/PATH/TO/ADDITIONAL_IMAGES"
      },
      "disabledTools": []
    }
  }
}
```

In Antigravity IDE, open the agent side panel, select **MCP Servers → Manage
MCP Servers → View raw config**, save the entry, and refresh the server.
Antigravity tools run in Ask mode by default unless your policy changes their
approval behavior.

## Permissions

The server process runs with the operating-system permissions of the MCP
client and current user. Its canonical allowed-root check is an additional
application-level restriction, not an operating-system sandbox.

- Grant the MCP client access only to directories it needs.
- On macOS, Files and Folders or Full Disk Access settings may affect what the
  client process can read. Avoid Full Disk Access unless it is genuinely
  required.
- On Windows, permissions, antivirus, or controlled-folder settings can block
  access.
- On Linux, normal file permissions and application sandboxing still apply.
- Keep client tool approvals enabled and inspect `filePath` before approving.

If the operating system denies access, adding a path to
`MCP_IMAGE_ALLOWED_ROOTS` does not bypass that denial.

## Security warnings

Read these before enabling the server:

- Treat every allowed root as data the connected client and model may receive.
- A malicious document, webpage, or prompt injection could try to convince the
  model to request a sensitive image. Review tool-call arguments.
- `MCP_IMAGE_ALLOWED_ROOTS` only adds access. It never narrows the default
  working-directory root.
- Do not launch from `/`, your home directory, or another broad tree unless
  that access is intentional.
- Canonical path checks block normal traversal and symlink escapes, but the
  server still operates with your user account's underlying permissions.
- File type is selected by filename extension. The server does not verify PNG,
  JPEG, or WebP binary signatures before reading and returning the file.
- The full file is loaded into memory and Base64-encoded. Very large files can
  consume significant memory and client context.
- Resolved paths and errors may be recorded in the ignored local
  `mcp-server.log`. Protect or delete that log according to your needs.
- Images returned by the tool leave the server process and become available to
  the MCP client and its configured model or model provider.
- This server has no authentication because it is designed as a local `stdio`
  child process. Do not expose it as a network service.
- Install code only from a repository and revision you trust. MCP servers run
  as local programs.

## Troubleshooting

### The client cannot start the server

- Run `npm ci` in the repository.
- Use absolute paths for Node and `index.js`.
- Confirm the paths with `which node` or `where node`.
- Run `node --check index.js` and `npm test`.
- Fully restart the MCP client after changing its configuration.

### The server starts but appears to hang

That is normal when you run `node index.js` directly. The server is waiting for
MCP messages on standard input.

### `Access denied: image path is outside allowed roots`

- Confirm the server's actual working directory.
- Put the file under that directory, set a narrow `cwd`, or add an explicit
  root through `MCP_IMAGE_ALLOWED_ROOTS`.
- Use `:` between additional roots on macOS/Linux and `;` on Windows.
- Check whether the requested path is a symlink that resolves elsewhere.

### `Image file not found in authorized roots`

- Confirm the filename and extension, including letter case.
- Confirm the file is beneath the current working directory or an additional
  authorized root.
- Provide a relative or absolute path when you already know the location.

### `Ambiguous image filename`

More than one authorized file has the requested name. Retry with one of the
exact paths listed in the error.

### `Image search exceeded 10,000 directory entries`

Use a more specific relative or absolute path, or configure a narrower working
directory and additional roots.

### The image loads but the model cannot interpret it

The selected model may not support vision, the client may not pass MCP image
content to that model, or the model may not support reliable tool calling.
Try a vision-capable, tool-capable model.

### Where are the logs?

The server writes `mcp-server.log` beside `logger.js` in the repository. The
file is excluded by `.gitignore`. Client-specific locations include:

- Claude Desktop on macOS: `~/Library/Logs/Claude`
- Antigravity: inspect the MCP Manager or server status UI
- Codex: run `codex mcp get local-image` and use `/mcp` in the TUI

MCP protocol output must use standard output, so server diagnostics are sent
to standard error and the log file.

## Official client documentation

Configuration formats can change. These examples were checked on 2026-07-25:

- [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [Claude Desktop local MCP servers](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)
- [Antigravity MCP configuration](https://antigravity.google/docs/mcp)

## License

[ISC](LICENSE), as declared in `package.json`.
