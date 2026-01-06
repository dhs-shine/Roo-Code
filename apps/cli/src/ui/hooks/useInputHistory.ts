/**
 * useInputHistory Hook
 *
 * Provides input history navigation for CLI text inputs.
 * Uses up/down arrow keys to navigate through previously entered prompts.
 * History is persisted to ~/.roo/cli-history.json
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useInput } from "ink"

import { loadHistory, addToHistory } from "../../utils/historyStorage.js"

export interface UseInputHistoryOptions {
	/**
	 * Whether the hook should respond to arrow key input.
	 * Set to false when input is not active/focused.
	 * @default true
	 */
	isActive?: boolean

	/**
	 * Callback to get the current input value when starting to browse history.
	 * This allows saving the user's draft before navigating.
	 */
	getCurrentInput?: () => string
}

export interface UseInputHistoryReturn {
	/**
	 * Add a new entry to history (call on submit)
	 */
	addEntry: (entry: string) => Promise<void>

	/**
	 * Current history value being browsed, or null if not browsing.
	 * Use this value to display in the input when browsing history.
	 */
	historyValue: string | null

	/**
	 * Whether currently browsing through history
	 */
	isBrowsing: boolean

	/**
	 * Reset browsing state and optionally save current input as draft.
	 * Call this when user starts typing.
	 */
	resetBrowsing: (currentInput?: string) => void

	/**
	 * All history entries (oldest first)
	 */
	history: string[]

	/**
	 * The saved draft (what user was typing before navigating history)
	 */
	draft: string

	/**
	 * Set the current draft value (call from onChange)
	 */
	setDraft: (value: string) => void
}

/**
 * Hook for managing input history with up/down arrow navigation
 *
 * @example
 * ```tsx
 * const { addEntry, historyValue, draft, setDraft } = useInputHistory({ isActive: true });
 *
 * // Track current input via onChange
 * <TextInput onChange={setDraft} ... />
 *
 * // When user submits input:
 * const handleSubmit = async (text: string) => {
 *   await addEntry(text);
 *   // ... handle submission
 * };
 *
 * // Use historyValue to control input:
 * // If historyValue is not null, display it instead of current input
 * ```
 */
export function useInputHistory(options: UseInputHistoryOptions = {}): UseInputHistoryReturn {
	const { isActive = true, getCurrentInput } = options

	// All history entries (oldest first, newest at end)
	const [history, setHistory] = useState<string[]>([])

	// Current position in history (-1 = not browsing, 0 = oldest, history.length-1 = newest)
	const [historyIndex, setHistoryIndex] = useState(-1)

	// The user's typed text before they started navigating history
	const [draft, setDraft] = useState("")

	// Flag to track if history has been loaded
	const historyLoaded = useRef(false)

	// Load history on mount
	useEffect(() => {
		if (!historyLoaded.current) {
			historyLoaded.current = true
			loadHistory()
				.then(setHistory)
				.catch(() => {
					// Ignore load errors - history is not critical
				})
		}
	}, [])

	// Handle up/down arrow keys for history navigation
	useInput(
		(_input, key) => {
			if (!isActive) return

			if (key.upArrow) {
				// Navigate to older entry
				if (history.length === 0) return

				if (historyIndex === -1) {
					// Starting to browse - save current input as draft
					if (getCurrentInput) {
						setDraft(getCurrentInput())
					}
					// Go to newest entry
					setHistoryIndex(history.length - 1)
				} else if (historyIndex > 0) {
					// Go to older entry
					setHistoryIndex(historyIndex - 1)
				}
				// At oldest entry - stay there
			} else if (key.downArrow) {
				// Navigate to newer entry
				if (historyIndex === -1) return // Not browsing

				if (historyIndex < history.length - 1) {
					// Go to newer entry
					setHistoryIndex(historyIndex + 1)
				} else {
					// At newest entry - return to draft
					setHistoryIndex(-1)
				}
			}
		},
		{ isActive },
	)

	// Add new entry to history
	const addEntry = useCallback(async (entry: string) => {
		const trimmed = entry.trim()
		if (!trimmed) return

		try {
			const updated = await addToHistory(trimmed)
			setHistory(updated)
		} catch {
			// Ignore save errors - history is not critical
		}

		// Reset navigation state
		setHistoryIndex(-1)
		setDraft("")
	}, [])

	// Reset browsing state
	const resetBrowsing = useCallback((currentInput?: string) => {
		setHistoryIndex(-1)
		if (currentInput !== undefined) {
			setDraft(currentInput)
		}
	}, [])

	// Calculate the current history value to display
	// When browsing, show history entry; when returning from browsing, show draft
	let historyValue: string | null = null
	if (historyIndex >= 0 && historyIndex < history.length) {
		historyValue = history[historyIndex] ?? null
	}

	const isBrowsing = historyIndex !== -1

	return {
		addEntry,
		historyValue,
		isBrowsing,
		resetBrowsing,
		history,
		draft,
		setDraft,
	}
}
