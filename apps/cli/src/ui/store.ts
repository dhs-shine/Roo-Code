import { create } from "zustand"

import type { TUIMessage, PendingAsk, FileSearchResult } from "./types.js"

interface CLIState {
	messages: TUIMessage[]
	pendingAsk: PendingAsk | null
	isLoading: boolean
	isComplete: boolean
	hasStartedTask: boolean
	error: string | null
	fileSearchResults: FileSearchResult[]
	isFilePickerOpen: boolean
	filePickerQuery: string
	filePickerSelectedIndex: number
}

interface CLIActions {
	addMessage: (msg: TUIMessage) => void
	updateMessage: (id: string, content: string, partial?: boolean) => void
	setPendingAsk: (ask: PendingAsk | null) => void
	setLoading: (loading: boolean) => void
	setComplete: (complete: boolean) => void
	setHasStartedTask: (started: boolean) => void
	setError: (error: string | null) => void
	reset: () => void
	setFileSearchResults: (results: FileSearchResult[]) => void
	setFilePickerOpen: (open: boolean) => void
	setFilePickerQuery: (query: string) => void
	setFilePickerSelectedIndex: (index: number) => void
	clearFilePicker: () => void
}

const initialState: CLIState = {
	messages: [],
	pendingAsk: null,
	isLoading: false,
	isComplete: false,
	hasStartedTask: false,
	error: null,
	fileSearchResults: [],
	isFilePickerOpen: false,
	filePickerQuery: "",
	filePickerSelectedIndex: 0,
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
	setFileSearchResults: (results) => set({ fileSearchResults: results, filePickerSelectedIndex: 0 }),
	setFilePickerOpen: (open) => set({ isFilePickerOpen: open }),
	setFilePickerQuery: (query) => set({ filePickerQuery: query }),
	setFilePickerSelectedIndex: (index) => set({ filePickerSelectedIndex: index }),
	clearFilePicker: () =>
		set({
			fileSearchResults: [],
			isFilePickerOpen: false,
			filePickerQuery: "",
			filePickerSelectedIndex: 0,
		}),
}))
