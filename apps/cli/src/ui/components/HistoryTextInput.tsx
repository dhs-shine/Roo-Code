/**
 * HistoryTextInput Component
 *
 * A TextInput wrapper that provides history navigation with up/down arrow keys.
 * Uses a key-based remount strategy to work with @inkjs/ui's uncontrolled TextInput.
 */

import { Box } from "ink"
import { TextInput } from "@inkjs/ui"
import { useCallback, useState, useEffect, useRef } from "react"

import { useInputHistory } from "../hooks/useInputHistory.js"

export interface HistoryTextInputProps {
	/** Placeholder text when input is empty */
	placeholder?: string
	/** Called when user submits input */
	onSubmit: (value: string) => void
	/** Whether history navigation is active */
	isActive?: boolean
	/** Whether to add submitted values to history */
	addToHistory?: boolean
}

/**
 * TextInput with history navigation support.
 *
 * - Up arrow: Navigate to older history entries (saves current input as draft)
 * - Down arrow: Navigate to newer entries or return to draft
 * - History persists to ~/.roo/cli-history.json
 */
export function HistoryTextInput({
	placeholder = "Type your message...",
	onSubmit,
	isActive = true,
	addToHistory = true,
}: HistoryTextInputProps) {
	// Track the current input value via onChange
	const currentInputRef = useRef("")

	const { addEntry, historyValue, isBrowsing, resetBrowsing, history, draft, setDraft } = useInputHistory({
		isActive,
		getCurrentInput: () => currentInputRef.current,
	})

	// Track previous browsing state to detect when we return from browsing
	const [wasBrowsing, setWasBrowsing] = useState(false)

	// Use a key to force remount when we need to change the defaultValue
	const [inputKey, setInputKey] = useState(0)

	// Track what value we're currently showing
	const [displayValue, setDisplayValue] = useState("")

	// Handle changes when entering or exiting history browsing
	useEffect(() => {
		if (isBrowsing && !wasBrowsing) {
			// Just started browsing - show history value
			if (historyValue !== null) {
				setDisplayValue(historyValue)
				setInputKey((k) => k + 1)
			}
		} else if (!isBrowsing && wasBrowsing) {
			// Just stopped browsing - restore draft
			setDisplayValue(draft)
			setInputKey((k) => k + 1)
			// Reset the current input ref to draft
			currentInputRef.current = draft
		} else if (isBrowsing && historyValue !== null && historyValue !== displayValue) {
			// Navigating within history
			setDisplayValue(historyValue)
			setInputKey((k) => k + 1)
		}
		setWasBrowsing(isBrowsing)
	}, [isBrowsing, wasBrowsing, historyValue, draft, displayValue])

	// Handle input changes
	const handleChange = useCallback(
		(value: string) => {
			currentInputRef.current = value
			// Also update draft if we're not browsing
			if (!isBrowsing) {
				setDraft(value)
			}
		},
		[isBrowsing, setDraft],
	)

	// Handle submit
	const handleSubmit = useCallback(
		async (text: string) => {
			const trimmed = text.trim()
			if (!trimmed) return

			// Add to history if enabled
			if (addToHistory) {
				await addEntry(trimmed)
			}

			// Reset browsing state and clear draft
			resetBrowsing("")
			currentInputRef.current = ""
			setDisplayValue("")
			setInputKey((k) => k + 1)

			// Call parent submit handler
			onSubmit(trimmed)
		},
		[addToHistory, addEntry, resetBrowsing, onSubmit],
	)

	return (
		<Box>
			<TextInput
				key={`history-input-${inputKey}-${history.length}`}
				defaultValue={displayValue}
				placeholder={placeholder}
				onChange={handleChange}
				onSubmit={handleSubmit}
			/>
		</Box>
	)
}

export default HistoryTextInput
