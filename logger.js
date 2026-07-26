import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure pino to write to a local file instead of stdout
export const logger = pino({
    level: 'debug',
    transport: {
        target: 'pino/file',
        options: {
            destination: path.join(__dirname, 'mcp-server.log'),
            mkdir: true
        }
    }
});

// A safety wrapper that also mirrors critical errors to stderr
export const agentLog = {
    info: (msg, data = {}) => logger.info(data, msg),
    debug: (msg, data = {}) => logger.debug(data, msg),
    error: (msg, error = {}) => {
        logger.error(error, msg);
        // Standard error (stderr) is safe for MCP and shows up in Antigravity's logs
        console.error(`[CRITICAL]: ${msg} ${error.message || ''}`);
    }
};
