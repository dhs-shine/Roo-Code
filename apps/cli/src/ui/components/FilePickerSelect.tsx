import { useMemo } from "react"
import { Box, Text, useInput } from "ink"

import type { FileSearchResult } from "../types.js"

export interface FilePickerSelectProps {
	results: FileSearchResult[]
	selectedIndex: number
	maxVisible?: number
	onSelect: (result: FileSearchResult) => void
	onEscape: () => void
	onIndexChange: (index: number) => void
	isActive?: boolean
}

export function FilePickerSelect({
	results,
	selectedIndex,
	maxVisible = 10,
	onSelect,
	onEscape,
	onIndexChange,
	isActive = true,
}: FilePickerSelectProps) {
	// Calculate the scroll window.
	const { visibleResults, scrollOffset } = useMemo(() => {
		if (results.length <= maxVisible) {
			return { visibleResults: results, scrollOffset: 0 }
		}

		// Calculate scroll offset to keep selected item visible.
		let offset = 0

		if (selectedIndex >= maxVisible) {
			// Need to scroll down.
			offset = Math.min(selectedIndex - maxVisible + 1, results.length - maxVisible)
		}

		// Keep selected item in the middle when possible.
		const idealOffset = Math.max(0, selectedIndex - Math.floor(maxVisible / 2))
		offset = Math.min(idealOffset, results.length - maxVisible)

		return {
			visibleResults: results.slice(offset, offset + maxVisible),
			scrollOffset: offset,
		}
	}, [results, selectedIndex, maxVisible])

	useInput(
		(input, key) => {
			if (!isActive) {
				return
			}

			if (key.escape) {
				onEscape()
				return
			}

			if (key.return) {
				const selected = results[selectedIndex]

				if (selected) {
					onSelect(selected)
				}

				return
			}

			if (key.upArrow) {
				const newIndex = selectedIndex > 0 ? selectedIndex - 1 : results.length - 1
				onIndexChange(newIndex)
				return
			}

			if (key.downArrow) {
				const newIndex = selectedIndex < results.length - 1 ? selectedIndex + 1 : 0
				onIndexChange(newIndex)
				return
			}
		},
		{ isActive },
	)

	if (results.length === 0) {
		return (
			<Box paddingLeft={2}>
				<Text dimColor>No matching files found</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column">
			{visibleResults.map((result, visibleIndex) => {
				const actualIndex = scrollOffset + visibleIndex
				const isSelected = actualIndex === selectedIndex
				const displayPath = result.type === "folder" ? `${result.path}/` : result.path

				return (
					<Box key={result.path} paddingLeft={2}>
						<Text color={isSelected ? "cyan" : undefined}>{displayPath}</Text>
					</Box>
				)
			})}
		</Box>
	)
}
