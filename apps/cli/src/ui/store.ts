import { create } from "zustand"

import type { TokenUsage, ProviderSettings, TodoItem } from "@roo-code/types"

import type {
	TUIMessage,
	PendingAsk,
	FileSearchResult,
	SlashCommandResult,
	ModeResult,
	TaskHistoryItem,
} from "./types.js"

/**
 * RouterModels type for context window lookup.
 * Simplified version - we only need contextWindow from ModelInfo.
 */
export type RouterModels = Record<string, Record<string, { contextWindow?: number }>>

/**
 * CLI application state.
 *
 * Note: Autocomplete picker UI state (isOpen, selectedIndex) is now managed
 * by the useAutocompletePicker hook. The store only holds data that needs
 * to be shared between components or persisted (like search results from API).
 */
interface CLIState {
	// Message history
	messages: TUIMessage[]
	pendingAsk: PendingAsk | null

	// Task state
	isLoading: boolean
	isComplete: boolean
	hasStartedTask: boolean
	error: string | null

	// Task resumption flag - true when resuming a task from history
	// Used to modify message processing behavior (e.g., don't skip first text message)
	isResumingTask: boolean

	// Autocomplete data (from API/extension)
	fileSearchResults: FileSearchResult[]
	allSlashCommands: SlashCommandResult[]
	availableModes: ModeResult[]

	// Task history (for resuming previous tasks)
	taskHistory: TaskHistoryItem[]

	// Current task ID (for detecting same-task reselection)
	currentTaskId: string | null

	// Current mode (updated reactively when mode changes)
	currentMode: string | null

	// Token usage metrics (from getApiMetrics)
	tokenUsage: TokenUsage | null

	// Model info for context window lookup
	routerModels: RouterModels | null
	apiConfiguration: ProviderSettings | null

	// Todo list tracking
	currentTodos: TodoItem[]
	previousTodos: TodoItem[]
}

interface CLIActions {
	// Message actions
	addMessage: (msg: TUIMessage) => void
	updateMessage: (id: string, content: string, partial?: boolean) => void

	// Task actions
	setPendingAsk: (ask: PendingAsk | null) => void
	setLoading: (loading: boolean) => void
	setComplete: (complete: boolean) => void
	setHasStartedTask: (started: boolean) => void
	setError: (error: string | null) => void
	reset: () => void
	/** Reset for task switching - preserves global state (taskHistory, modes, commands) */
	resetForTaskSwitch: () => void
	/** Set the isResumingTask flag - used when resuming a task from history */
	setIsResumingTask: (isResuming: boolean) => void

	// Autocomplete data actions
	setFileSearchResults: (results: FileSearchResult[]) => void
	setAllSlashCommands: (commands: SlashCommandResult[]) => void
	setAvailableModes: (modes: ModeResult[]) => void

	// Task history action
	setTaskHistory: (history: TaskHistoryItem[]) => void

	// Current task ID action
	setCurrentTaskId: (taskId: string | null) => void

	// Current mode action
	setCurrentMode: (mode: string | null) => void

	// Metrics actions
	setTokenUsage: (usage: TokenUsage | null) => void
	setRouterModels: (models: RouterModels | null) => void
	setApiConfiguration: (config: ProviderSettings | null) => void

	// Todo actions
	setTodos: (todos: TodoItem[]) => void
}

const initialState: CLIState = {
	messages: [],
	pendingAsk: null,
	isLoading: false,
	isComplete: false,
	hasStartedTask: false,
	error: null,
	isResumingTask: false,
	fileSearchResults: [],
	allSlashCommands: [],
	availableModes: [],
	taskHistory: [],
	currentTaskId: null,
	currentMode: null,
	tokenUsage: null,
	routerModels: null,
	apiConfiguration: null,
	currentTodos: [],
	previousTodos: [],
}

export const useCLIStore = create<CLIState & CLIActions>((set) => ({
	...initialState,

	addMessage: (msg) =>
		set((state) => {
			// Check if message already exists (by ID).
			const existingIndex = state.messages.findIndex((m) => m.id === msg.id)

			if (existingIndex !== -1) {
				// Update existing message in place.
				const updated = [...state.messages]
				updated[existingIndex] = msg
				return { messages: updated }
			}

			// Add new message.
			return { messages: [...state.messages, msg] }
		}),

	updateMessage: (id, content, partial) =>
		set((state) => {
			const index = state.messages.findIndex((m) => m.id === id)

			if (index === -1) {
				return state
			}

			const existing = state.messages[index]

			if (!existing) {
				return state
			}

			const updated = [...state.messages]

			updated[index] = {
				...existing,
				content,
				partial: partial !== undefined ? partial : existing.partial,
			}

			return { messages: updated }
		}),

	setPendingAsk: (ask) => set({ pendingAsk: ask }),
	setLoading: (loading) => set({ isLoading: loading }),
	setComplete: (complete) => set({ isComplete: complete }),
	setHasStartedTask: (started) => set({ hasStartedTask: started }),
	setError: (error) => set({ error }),
	reset: () => set(initialState),
	resetForTaskSwitch: () =>
		set((state) => ({
			// Clear task-specific state
			messages: [],
			pendingAsk: null,
			isLoading: false,
			isComplete: false,
			hasStartedTask: false,
			error: null,
			isResumingTask: false,
			tokenUsage: null,
			currentTodos: [],
			previousTodos: [],
			// currentTaskId is preserved - will be updated to new task ID by caller
			currentTaskId: state.currentTaskId,
			// PRESERVE global state - don't clear these
			taskHistory: state.taskHistory,
			availableModes: state.availableModes,
			allSlashCommands: state.allSlashCommands,
			fileSearchResults: state.fileSearchResults,
			currentMode: state.currentMode,
			routerModels: state.routerModels,
			apiConfiguration: state.apiConfiguration,
		})),
	setIsResumingTask: (isResuming) => set({ isResumingTask: isResuming }),
	setFileSearchResults: (results) => set({ fileSearchResults: results }),
	setAllSlashCommands: (commands) => set({ allSlashCommands: commands }),
	setAvailableModes: (modes) => set({ availableModes: modes }),
	setTaskHistory: (history) => set({ taskHistory: history }),
	setCurrentTaskId: (taskId) => set({ currentTaskId: taskId }),
	setCurrentMode: (mode) => set({ currentMode: mode }),
	setTokenUsage: (usage) => set({ tokenUsage: usage }),
	setRouterModels: (models) => set({ routerModels: models }),
	setApiConfiguration: (config) => set({ apiConfiguration: config }),
	setTodos: (todos) =>
		set((state) => ({
			previousTodos: state.currentTodos,
			currentTodos: todos,
		})),
}))
