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
