import { useState, useCallback, useRef, useEffect } from "react"

import type {
	AutocompleteItem,
	AutocompleteTrigger,
	AutocompletePickerState,
	AutocompletePickerActions,
	TriggerDetectionResult,
} from "./types.js"

const DEFAULT_DEBOUNCE_MS = 150

/**
 * Hook that manages autocomplete picker state and logic.
 *
 * @template T - The type of autocomplete items
 * @param triggers - Array of autocomplete triggers to check
 * @returns Picker state and actions
 */
export function useAutocompletePicker<T extends AutocompleteItem>(
	triggers: AutocompleteTrigger<T>[],
): [AutocompletePickerState<T>, AutocompletePickerActions<T>] {
	const [state, setState] = useState<AutocompletePickerState<T>>({
		activeTrigger: null,
		results: [],
		selectedIndex: 0,
		isOpen: false,
		isLoading: false,
		triggerInfo: null,
	})

	// Debounce timer refs for each trigger
	const debounceTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
	const lastQueriesRef = useRef<Map<string, string>>(new Map())

	// Cleanup debounce timers on unmount
	useEffect(() => {
		return () => {
			debounceTimersRef.current.forEach((timer) => clearTimeout(timer))
		}
	}, [])

	/**
	 * Get the last line from the input value
	 */
	const getLastLine = useCallback((value: string): string => {
		const lines = value.split("\n")
		return lines[lines.length - 1] || ""
	}, [])

	/**
	 * Handle input value changes - detects triggers and initiates search
	 */
	const handleInputChange = useCallback(
		(value: string, lineText?: string) => {
			const lastLine = lineText ?? getLastLine(value)

			// Check each trigger for activation
			let foundTrigger: AutocompleteTrigger<T> | null = null
			let foundTriggerInfo: TriggerDetectionResult | null = null

			for (const trigger of triggers) {
				const detection = trigger.detectTrigger(lastLine)
				if (detection) {
					foundTrigger = trigger
					foundTriggerInfo = detection
					break
				}
			}

			// No trigger found - close picker
			if (!foundTrigger || !foundTriggerInfo) {
				if (state.isOpen) {
					setState((prev) => ({
						...prev,
						activeTrigger: null,
						results: [],
						selectedIndex: 0,
						isOpen: false,
						isLoading: false,
						triggerInfo: null,
					}))
				}
				return
			}

			const { query } = foundTriggerInfo
			const debounceMs = foundTrigger.debounceMs ?? DEFAULT_DEBOUNCE_MS

			// Clear existing debounce timer for this trigger
			const existingTimer = debounceTimersRef.current.get(foundTrigger.id)
			if (existingTimer) {
				clearTimeout(existingTimer)
			}

			// Check if query has changed
			const lastQuery = lastQueriesRef.current.get(foundTrigger.id)
			if (query === lastQuery && state.isOpen && state.activeTrigger?.id === foundTrigger.id) {
				// Same query, same trigger - no need to search again
				return
			}

			// Set loading state immediately
			setState((prev) => ({
				...prev,
				activeTrigger: foundTrigger,
				isLoading: true,
				triggerInfo: foundTriggerInfo,
			}))

			// Debounce the search
			const timer = setTimeout(async () => {
				lastQueriesRef.current.set(foundTrigger.id, query)

				try {
					const results = await foundTrigger.search(query)

					setState((prev) => {
						// Only update if this is still the active trigger
						if (prev.activeTrigger?.id !== foundTrigger.id) {
							return prev
						}

						return {
							...prev,
							results,
							selectedIndex: 0,
							isOpen: results.length > 0 || query.length > 0,
							isLoading: false,
						}
					})
				} catch (_error) {
					// On error, close picker
					setState((prev) => ({
						...prev,
						results: [],
						isOpen: false,
						isLoading: false,
					}))
				}
			}, debounceMs)

			debounceTimersRef.current.set(foundTrigger.id, timer)
		},
		[triggers, state.isOpen, state.activeTrigger?.id, getLastLine],
	)

	/**
	 * Handle item selection - returns the new input value with the selection inserted
	 */
	const handleSelect = useCallback(
		(item: T, fullValue: string, lineText?: string): string => {
			const { activeTrigger, triggerInfo } = state

			if (!activeTrigger || !triggerInfo) {
				return fullValue
			}

			// Get the lines
			const lines = fullValue.split("\n")
			const lastLineIndex = lines.length - 1
			const lastLine = lineText ?? lines[lastLineIndex] ?? ""

			// Get replacement text from trigger
			const newLastLine = activeTrigger.getReplacementText(item, lastLine, triggerInfo.triggerIndex)

			// Replace the last line
			lines[lastLineIndex] = newLastLine
			const newValue = lines.join("\n")

			// Reset state
			setState({
				activeTrigger: null,
				results: [],
				selectedIndex: 0,
				isOpen: false,
				isLoading: false,
				triggerInfo: null,
			})

			// Clear last query for this trigger
			lastQueriesRef.current.delete(activeTrigger.id)

			return newValue
		},
		[state],
	)

	/**
	 * Close the picker
	 */
	const handleClose = useCallback(() => {
		// Clear any pending debounce timers
		debounceTimersRef.current.forEach((timer) => clearTimeout(timer))
		debounceTimersRef.current.clear()

		setState({
			activeTrigger: null,
			results: [],
			selectedIndex: 0,
			isOpen: false,
			isLoading: false,
			triggerInfo: null,
		})
	}, [])

	/**
	 * Update selected index
	 */
	const handleIndexChange = useCallback((index: number) => {
		setState((prev) => ({
			...prev,
			selectedIndex: index,
		}))
	}, [])

	/**
	 * Navigate selection up (with wrap-around)
	 */
	const navigateUp = useCallback(() => {
		setState((prev) => {
			if (prev.results.length === 0) return prev
			const newIndex = prev.selectedIndex > 0 ? prev.selectedIndex - 1 : prev.results.length - 1
			return { ...prev, selectedIndex: newIndex }
		})
	}, [])

	/**
	 * Navigate selection down (with wrap-around)
	 */
	const navigateDown = useCallback(() => {
		setState((prev) => {
			if (prev.results.length === 0) return prev
			const newIndex = prev.selectedIndex < prev.results.length - 1 ? prev.selectedIndex + 1 : 0
			return { ...prev, selectedIndex: newIndex }
		})
	}, [])

	const actions: AutocompletePickerActions<T> = {
		handleInputChange,
		handleSelect,
		handleClose,
		handleIndexChange,
		navigateUp,
		navigateDown,
	}

	return [state, actions]
}
