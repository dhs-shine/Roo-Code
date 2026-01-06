import { Box, Text } from "ink"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

/**
 * File search result type.
 * Extends AutocompleteItem with file-specific properties.
 */
export interface FileResult extends AutocompleteItem {
	/** File or folder path */
	path: string
	/** Whether this is a file or folder */
	type: "file" | "folder"
	/** Optional display label */
	label?: string
}

/**
 * Props for creating a file trigger
 */
export interface FileTriggerConfig {
	/**
	 * Called when a search should be performed.
	 * This typically triggers an API call to search files.
	 */
	onSearch: (query: string) => void
	/**
	 * Current search results from the store/API.
	 * Results are provided externally because file search is async.
	 */
	getResults: () => FileResult[]
}

/**
 * Create a file trigger for @ mentions.
 *
 * This trigger activates when the user types @ followed by text,
 * and allows selecting files to insert as @/path references.
 *
 * @param config - Configuration for the trigger
 * @returns AutocompleteTrigger for file mentions
 */
export function createFileTrigger(config: FileTriggerConfig): AutocompleteTrigger<FileResult> {
	const { onSearch, getResults } = config

	return {
		id: "file",
		triggerChar: "@",
		position: "anywhere",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			// Find the last @ in the line
			const atIndex = lineText.lastIndexOf("@")

			if (atIndex === -1) {
				return null
			}

			// Extract query after @
			const query = lineText.substring(atIndex + 1)

			// Close picker if query contains space (user finished typing)
			if (query.includes(" ")) {
				return null
			}

			// Require at least one character after @
			if (query.length === 0) {
				return null
			}

			return { query, triggerIndex: atIndex }
		},

		search: (query: string): FileResult[] => {
			// Trigger the external search
			onSearch(query)
			// Return current results from store
			// Results will update asynchronously and trigger a re-render
			return getResults()
		},

		renderItem: (item: FileResult, isSelected: boolean) => {
			const displayPath = item.type === "folder" ? `${item.path}/` : item.path

			return (
				<Box paddingLeft={2}>
					<Text color={isSelected ? "cyan" : undefined}>{displayPath}</Text>
				</Box>
			)
		},

		getReplacementText: (item: FileResult, lineText: string, triggerIndex: number): string => {
			const beforeAt = lineText.substring(0, triggerIndex)
			return `${beforeAt}@/${item.path} `
		},

		emptyMessage: "No matching files found",
		debounceMs: 150,
	}
}

/**
 * Convert external FileSearchResult to FileResult.
 * Use this to adapt results from the store to the trigger's expected type.
 */
export function toFileResult(result: { path: string; type: "file" | "folder"; label?: string }): FileResult {
	return {
		key: result.path,
		path: result.path,
		type: result.type,
		label: result.label,
	}
}
