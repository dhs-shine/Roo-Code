/**
 * File-based debug logging utility
 *
 * Re-exports from @roo-code/core/debug-log for consistency across the codebase.
 * This writes logs to ~/.roo/cli-debug.log, avoiding stdout/stderr
 * which would break TUI applications.
 *
 * Usage:
 *   import { debugLog, DebugLogger } from "../utils/debug-log"
 *
 *   // Simple logging
 *   debugLog("handleModeSwitch", { mode: newMode, configId })
 *
 *   // Or create a named logger for a component
 *   const log = new DebugLogger("ClineProvider")
 *   log.info("handleModeSwitch", { mode: newMode })
 */

export { debugLog, DebugLogger, providerDebugLog } from "@roo-code/core/debug-log"
