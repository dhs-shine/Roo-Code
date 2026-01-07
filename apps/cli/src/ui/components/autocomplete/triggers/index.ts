/**
 * Autocomplete triggers for different trigger patterns.
 */

export { createFileTrigger, toFileResult, type FileResult, type FileTriggerConfig } from "./FileTrigger.js"

export {
	createSlashCommandTrigger,
	toSlashCommandResult,
	type SlashCommandResult,
	type SlashCommandTriggerConfig,
} from "./SlashCommandTrigger.js"

export { createModeTrigger, toModeResult, type ModeResult, type ModeTriggerConfig } from "./ModeTrigger.js"

export { createHelpTrigger, type HelpShortcutResult } from "./HelpTrigger.js"

export {
	createHistoryTrigger,
	toHistoryResult,
	type HistoryResult,
	type HistoryTriggerConfig,
} from "./HistoryTrigger.js"
