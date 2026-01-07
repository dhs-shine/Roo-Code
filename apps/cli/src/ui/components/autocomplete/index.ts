/**
 * Autocomplete system for CLI input.
 *
 * This module provides a generic, extensible autocomplete system that supports
 * multiple trigger patterns (like @ for files, / for commands) through a
 * plugin-like trigger architecture.
 *
 * @example
 * ```tsx
 * import {
 *   AutocompleteInput,
 *   PickerSelect,
 *   useAutocompletePicker,
 *   createFileTrigger,
 *   createSlashCommandTrigger,
 * } from './autocomplete'
 *
 * const triggers = [
 *   createFileTrigger({ onSearch, getResults }),
 *   createSlashCommandTrigger({ getCommands }),
 * ]
 *
 * <AutocompleteInput
 *   triggers={triggers}
 *   onSubmit={handleSubmit}
 * />
 * ```
 */

// Main components
export { AutocompleteInput, type AutocompleteInputProps, type AutocompleteInputHandle } from "./AutocompleteInput.js"
export { PickerSelect, type PickerSelectProps } from "./PickerSelect.js"

// Hook
export { useAutocompletePicker } from "./useAutocompletePicker.js"

// Types
export type {
	AutocompleteItem,
	AutocompleteTrigger,
	AutocompletePickerState,
	AutocompletePickerActions,
	TriggerDetectionResult,
} from "./types.js"

// Triggers
export {
	createFileTrigger,
	toFileResult,
	type FileResult,
	type FileTriggerConfig,
	createSlashCommandTrigger,
	toSlashCommandResult,
	type SlashCommandResult,
	type SlashCommandTriggerConfig,
	createModeTrigger,
	toModeResult,
	type ModeResult,
	type ModeTriggerConfig,
} from "./triggers/index.js"
