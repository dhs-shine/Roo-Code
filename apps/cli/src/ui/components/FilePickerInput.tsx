import { useInput } from "ink"
import { TextInput } from "@inkjs/ui"
import { useState, useCallback, useEffect, useRef } from "react"

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
}: FilePickerInputProps) {
	const currentInputRef = useRef("")
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
	const lastSearchQueryRef = useRef<string | null>(null)

	const [inputKey, setInputKey] = useState(0)
	const [displayValue, setDisplayValue] = useState("")

	const { addEntry, historyValue, isBrowsing, resetBrowsing, history, draft, setDraft } = useInputHistory({
		isActive: isActive && !isFilePickerOpen,
		getCurrentInput: () => currentInputRef.current,
	})

	const [wasBrowsing, setWasBrowsing] = useState(false)

	useEffect(() => {
		if (isBrowsing && !wasBrowsing) {
			if (historyValue !== null) {
				setDisplayValue(historyValue)
				setInputKey((k) => k + 1)
			}
		} else if (!isBrowsing && wasBrowsing) {
			setDisplayValue(draft)
			setInputKey((k) => k + 1)
			currentInputRef.current = draft
		} else if (isBrowsing && historyValue !== null && historyValue !== displayValue) {
			setDisplayValue(historyValue)
			setInputKey((k) => k + 1)
		}

		setWasBrowsing(isBrowsing)
	}, [isBrowsing, wasBrowsing, historyValue, draft, displayValue])

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const checkForAtTrigger = useCallback(
		(value: string) => {
			const atIndex = value.lastIndexOf("@")

			if (atIndex === -1) {
				if (isFilePickerOpen) {
					onFilePickerClose()
				}

				return
			}

			const query = value.substring(atIndex + 1)

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
			currentInputRef.current = value

			checkForAtTrigger(value)

			if (!isBrowsing) {
				setDraft(value)
			}
		},
		[checkForAtTrigger, isBrowsing, setDraft],
	)

	const handleFileSelect = useCallback(
		(result: FileSearchResult) => {
			const currentValue = currentInputRef.current
			const atIndex = currentValue.lastIndexOf("@")

			if (atIndex !== -1) {
				const beforeAt = currentValue.substring(0, atIndex)
				const newValue = `${beforeAt}@/${result.path} `

				currentInputRef.current = newValue
				setDisplayValue(newValue)
				setInputKey((k) => k + 1)
				setDraft(newValue)

				lastSearchQueryRef.current = null
				onFilePickerClose()
			}
		},
		[onFilePickerClose, setDraft],
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
			currentInputRef.current = ""
			lastSearchQueryRef.current = null
			setDisplayValue("")
			setInputKey((k) => k + 1)

			onSubmit(trimmed)
		},
		[isFilePickerOpen, addEntry, resetBrowsing, onSubmit],
	)

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
		<TextInput
			key={`file-picker-input-${inputKey}-${history.length}`}
			defaultValue={displayValue}
			placeholder={placeholder}
			onChange={handleChange}
			onSubmit={handleSubmit}
		/>
	)
}
