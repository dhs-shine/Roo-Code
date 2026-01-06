// Main App
export { type TUIAppProps, App } from "./App.js"

// Components
export { default as Header } from "./components/Header.js"
export { default as ChatHistoryItem } from "./components/ChatHistoryItem.js"
export { default as LoadingText } from "./components/LoadingText.js"

// Autocomplete system
export {
	AutocompleteInput,
	PickerSelect,
	useAutocompletePicker,
	createFileTrigger,
	createSlashCommandTrigger,
	toFileResult,
	toSlashCommandResult,
	type AutocompleteInputProps,
	type AutocompleteInputHandle,
	type AutocompleteItem,
	type AutocompleteTrigger,
	type AutocompletePickerState,
	type PickerSelectProps,
	type FileResult,
	type SlashCommandResult as AutocompleteSlashCommandResult,
} from "./components/autocomplete/index.js"

// Hooks
export { useInputHistory } from "./hooks/useInputHistory.js"
export type { UseInputHistoryOptions, UseInputHistoryReturn } from "./hooks/useInputHistory.js"

// Store
export { useCLIStore } from "./store.js"

// Theme
export * as theme from "./utils/theme.js"

// Types
export type { TUIMessage, PendingAsk, SayType, AskType, AppProps, MessageRole, View } from "./types.js"
