import { useInput } from "ink"
import { useState, useCallback, useEffect, useRef } from "react"

import { MultilineTextInput } from "./MultilineTextInput.js"
import { useInputHistory } from "../hooks/useInputHistory.js"
import type { FileSearchResult } from "../types.js"

export interface FilePickerInputProps {
	placeholder?: string
	onSubmit: (value: string) => void
	isActive?: boolean
	onFileSearch: (query: string) => void
	fileSearchResults: FileSearchResult[]
	isFilePickerOpen: boolean
	filePickerSelectedIndex: number
	onFileSelect: (result: FileSearchResult) => void
	onFilePickerClose: () => void
	onFilePickerIndexChange: (index: number) => void
	/**
	 * Prompt character for the first line (default: "> ")
	 */
	prompt?: string
	/**
	 * Indent string for continuation lines (default: "  ")
	 */
	continuationIndent?: string
}

const SEARCH_DEBOUNCE_MS = 150

export function FilePickerInput({
	placeholder = "Type your message...",
	onSubmit,
	isActive = true,
	onFileSearch,
	fileSearchResults,
	isFilePickerOpen,
	filePickerSelectedIndex,
	onFilePickerClose,
	prompt = "> ",
	continuationIndent = "  ",
}: FilePickerInputProps) {
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
	const lastSearchQueryRef = useRef<string | null>(null)

	const [inputValue, setInputValue] = useState("")

	const { addEntry, historyValue, isBrowsing, resetBrowsing, history, draft, setDraft, navigateUp, navigateDown } =
		useInputHistory({
			isActive: isActive && !isFilePickerOpen,
			getCurrentInput: () => inputValue,
		})

	const [wasBrowsing, setWasBrowsing] = useState(false)

	// Handle history navigation
	useEffect(() => {
		if (isBrowsing && !wasBrowsing) {
			if (historyValue !== null) {
				setInputValue(historyValue)
			}
		} else if (!isBrowsing && wasBrowsing) {
			setInputValue(draft)
		} else if (isBrowsing && historyValue !== null && historyValue !== inputValue) {
			setInputValue(historyValue)
		}

		setWasBrowsing(isBrowsing)
	}, [isBrowsing, wasBrowsing, historyValue, draft, inputValue])

	// Cleanup debounce timer
	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const checkForAtTrigger = useCallback(
		(value: string) => {
			// Check on the last line for @ trigger
			const lines = value.split("\n")
			const lastLine = lines[lines.length - 1] || ""
			const atIndex = lastLine.lastIndexOf("@")

			if (atIndex === -1) {
				if (isFilePickerOpen) {
					onFilePickerClose()
				}

				return
			}

			const query = lastLine.substring(atIndex + 1)

			if (query.includes(" ")) {
				if (isFilePickerOpen) {
					onFilePickerClose()
				}

				return
			}

			if (query.length === 0) {
				if (isFilePickerOpen) {
					onFilePickerClose()
				}

				return
			}

			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}

			if (query !== lastSearchQueryRef.current) {
				debounceTimerRef.current = setTimeout(() => {
					lastSearchQueryRef.current = query
					onFileSearch(query)
				}, SEARCH_DEBOUNCE_MS)
			}
		},
		[isFilePickerOpen, onFilePickerClose, onFileSearch],
	)

	const handleChange = useCallback(
		(value: string) => {
			setInputValue(value)
			checkForAtTrigger(value)

			if (!isBrowsing) {
				setDraft(value)
			}
		},
		[checkForAtTrigger, isBrowsing, setDraft],
	)

	const handleFileSelect = useCallback(
		(result: FileSearchResult) => {
			// Find and replace the @ trigger on the last line
			const lines = inputValue.split("\n")
			const lastLineIndex = lines.length - 1
			const lastLine = lines[lastLineIndex] || ""
			const atIndex = lastLine.lastIndexOf("@")

			if (atIndex !== -1) {
				const beforeAt = lastLine.substring(0, atIndex)
				lines[lastLineIndex] = `${beforeAt}@/${result.path} `
				const newValue = lines.join("\n")

				setInputValue(newValue)
				setDraft(newValue)
				lastSearchQueryRef.current = null
				onFilePickerClose()
			}
		},
		[inputValue, onFilePickerClose, setDraft],
	)

	const handleSubmit = useCallback(
		async (text: string) => {
			const trimmed = text.trim()

			if (!trimmed) {
				return
			}

			if (isFilePickerOpen) {
				return
			}

			await addEntry(trimmed)

			resetBrowsing("")
			lastSearchQueryRef.current = null
			setInputValue("")

			onSubmit(trimmed)
		},
		[isFilePickerOpen, addEntry, resetBrowsing, onSubmit],
	)

	const handleEscape = useCallback(() => {
		// Clear all input on Escape
		setInputValue("")
		setDraft("")
		resetBrowsing("")
		lastSearchQueryRef.current = null
		if (isFilePickerOpen) {
			onFilePickerClose()
		}
	}, [setDraft, resetBrowsing, isFilePickerOpen, onFilePickerClose])

	// Handle file picker selection with Enter
	useInput(
		(_input, key) => {
			if (!isActive || !isFilePickerOpen) {
				return
			}

			if (key.return) {
				const selected = fileSearchResults[filePickerSelectedIndex]

				if (selected) {
					handleFileSelect(selected)
				}
			}
		},
		{ isActive: isActive && isFilePickerOpen },
	)

	return (
		<MultilineTextInput
			key={`file-picker-input-${history.length}`}
			value={inputValue}
			onChange={handleChange}
			onSubmit={handleSubmit}
			onEscape={handleEscape}
			onUpAtFirstLine={navigateUp}
			onDownAtLastLine={navigateDown}
			placeholder={placeholder}
			isActive={isActive}
			showCursor={true}
			prompt={prompt}
			continuationIndent={continuationIndent}
		/>
	)
}
