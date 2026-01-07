import { useEffect, useReducer, type ReactNode } from "react"
import { Box, Text, useInput } from "ink"

import { ScrollArea } from "../ScrollArea.js"
import type { AutocompleteItem } from "./types.js"

export interface PickerSelectProps<T extends AutocompleteItem> {
	/** Results to display in the picker */
	results: T[]
	/** Currently selected index */
	selectedIndex: number
	/** Maximum number of visible items */
	maxVisible?: number
	/** Called when an item is selected */
	onSelect: (item: T) => void
	/** Called when escape is pressed */
	onEscape: () => void
	/** Called when selection index changes */
	onIndexChange: (index: number) => void
	/** Render function for each item */
	renderItem: (item: T, isSelected: boolean) => ReactNode
	/** Message shown when results are empty */
	emptyMessage?: string
	/** Whether the picker accepts keyboard input */
	isActive?: boolean
}

/**
 * Generic picker dropdown component for autocomplete.
 * Handles keyboard navigation and item selection.
 *
 * @template T - The type of items to display
 */
export function PickerSelect<T extends AutocompleteItem>({
	results,
	selectedIndex,
	maxVisible = 10,
	onSelect,
	onEscape,
	onIndexChange,
	renderItem,
	emptyMessage = "No results found",
	isActive = true,
}: PickerSelectProps<T>) {
	// Trigger for scrolling to the selected line
	const [scrollTrigger, incrementScrollTrigger] = useReducer((x: number) => x + 1, 0)

	// Scroll to selected item when selection changes
	useEffect(() => {
		incrementScrollTrigger()
	}, [selectedIndex])

	useInput(
		(_input, key) => {
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
				<Text dimColor>{emptyMessage}</Text>
			</Box>
		)
	}

	// Height for the scroll area - use maxVisible as the viewport height
	const scrollHeight = Math.min(results.length, maxVisible)

	return (
		<ScrollArea
			height={scrollHeight}
			isActive={false}
			showScrollbar={true}
			scrollToLine={selectedIndex}
			scrollToLineTrigger={scrollTrigger}
			autoScroll={false}>
			{results.map((result, index) => {
				const isSelected = index === selectedIndex
				return <Box key={result.key}>{renderItem(result, isSelected)}</Box>
			})}
		</ScrollArea>
	)
}
