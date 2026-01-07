/**
 * Tool Inspector Logger
 *
 * A dedicated logger for inspecting tool use payloads in the CLI.
 * This writes to ~/.roo/cli-tool-inspector.log, separate from the general
 * debug log to avoid noise when specifically investigating tool shapes.
 *
 * Usage:
 *   import { toolInspectorLog } from "../utils/toolInspectorLogger.js"
 *
 *   toolInspectorLog("tool:received", { toolName, payload })
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const TOOL_INSPECTOR_LOG_PATH = path.join(os.homedir(), ".roo", "cli-tool-inspector.log")

/**
 * Log a tool inspection entry to the dedicated log file.
 * Writes timestamped JSON entries to ~/.roo/cli-tool-inspector.log
 */
export function toolInspectorLog(event: string, data?: unknown): void {
	try {
		const logDir = path.dirname(TOOL_INSPECTOR_LOG_PATH)

		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true })
		}

		const timestamp = new Date().toISOString()

		const entry = {
			timestamp,
			event,
			...(data !== undefined && { data }),
		}

		// Write as formatted JSON for easier inspection
		fs.appendFileSync(TOOL_INSPECTOR_LOG_PATH, JSON.stringify(entry, null, 2) + "\n---\n")
	} catch {
		// NO-OP - don't let logging errors break functionality
	}
}

/**
 * Clear the tool inspector log file.
 * Useful for starting a fresh inspection session.
 */
export function clearToolInspectorLog(): void {
	try {
		if (fs.existsSync(TOOL_INSPECTOR_LOG_PATH)) {
			fs.unlinkSync(TOOL_INSPECTOR_LOG_PATH)
		}
	} catch {
		// NO-OP
	}
}

/**
 * Get the path to the tool inspector log file.
 */
export function getToolInspectorLogPath(): string {
	return TOOL_INSPECTOR_LOG_PATH
}
