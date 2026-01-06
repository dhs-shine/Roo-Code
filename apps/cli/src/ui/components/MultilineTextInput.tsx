/**
 * MultilineTextInput Component
 *
 * A multi-line text input for Ink CLI applications.
 * Based on ink-multiline-input but simplified for our needs.
 *
 * Key behaviors:
 * - Ctrl+Enter: Add new line
 * - Enter: Submit
 * - Backspace at start of line: Merge with previous line
 * - Escape: Clear all lines
 * - Arrow keys: Navigate within and between lines
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Box, Text, useInput, type Key } from "ink"

export interface MultilineTextInputProps {
	/**
	 * Current value (can contain newlines)
	 */
	value: string
	/**
	 * Called when the value changes
	 */
	onChange: (value: string) => void
	/**
	 * Called when user submits (Enter without Ctrl)
	 */
	onSubmit?: (value: string) => void
	/**
	 * Called when user presses Escape
	 */
	onEscape?: () => void
	/**
	 * Called when up arrow is pressed while cursor is on the first line
	 * Use this to trigger history navigation
	 */
	onUpAtFirstLine?: () => void
	/**
	 * Called when down arrow is pressed while cursor is on the last line
	 * Use this to trigger history navigation
	 */
	onDownAtLastLine?: () => void
	/**
	 * Placeholder text when empty
	 */
	placeholder?: string
	/**
	 * Whether the input is active/focused
	 */
	isActive?: boolean
	/**
	 * Whether to show the cursor
	 */
	showCursor?: boolean
	/**
	 * Prompt character for the first line
	 */
	prompt?: string
	/**
	 * Indent string for continuation lines
	 */
	continuationIndent?: string
	/**
	 * Terminal width in columns - used for proper line wrapping
	 * If not provided, lines won't be wrapped
	 */
	columns?: number
}

/**
 * Normalize line endings to LF (\n)
 */
function normalizeLineEndings(text: string): string {
	if (text == null) return ""
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/**
 * Calculate line and column position from cursor index
 */
function getCursorPosition(value: string, cursorIndex: number): { line: number; col: number } {
	const lines = value.split("\n")
	let pos = 0
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		const lineEnd = pos + line.length
		if (cursorIndex <= lineEnd) {
			return { line: i, col: cursorIndex - pos }
		}
		pos = lineEnd + 1 // +1 for newline
	}
	// Cursor at very end
	return { line: lines.length - 1, col: (lines[lines.length - 1] || "").length }
}

/**
 * Calculate cursor index from line and column position
 */
function getIndexFromPosition(value: string, line: number, col: number): number {
	const lines = value.split("\n")
	let index = 0
	for (let i = 0; i < line && i < lines.length; i++) {
		index += lines[i]!.length + 1 // +1 for newline
	}
	const targetLine = lines[line] || ""
	index += Math.min(col, targetLine.length)
	return index
}

/**
 * Represents a visual row after wrapping a logical line
 */
interface VisualRow {
	text: string
	logicalLineIndex: number
	isFirstRowOfLine: boolean
	startCol: number // column offset in the logical line
}

/**
 * Wrap a logical line into visual rows based on available width
 */
function wrapLine(lineText: string, logicalLineIndex: number, availableWidth: number): VisualRow[] {
	if (availableWidth <= 0 || lineText.length <= availableWidth) {
		return [
			{
				text: lineText,
				logicalLineIndex,
				isFirstRowOfLine: true,
				startCol: 0,
			},
		]
	}

	const rows: VisualRow[] = []
	let remaining = lineText
	let startCol = 0
	let isFirst = true

	while (remaining.length > 0) {
		const chunk = remaining.slice(0, availableWidth)
		rows.push({
			text: chunk,
			logicalLineIndex,
			isFirstRowOfLine: isFirst,
			startCol,
		})
		remaining = remaining.slice(availableWidth)
		startCol += availableWidth
		isFirst = false
	}

	// If the line ends exactly at the width boundary, add an empty row for cursor
	if (lineText.length > 0 && lineText.length % availableWidth === 0) {
		// The last row already exists, no need to add empty row
	}

	return rows
}

export function MultilineTextInput({
	value,
	onChange,
	onSubmit,
	onEscape,
	onUpAtFirstLine,
	onDownAtLastLine,
	placeholder = "",
	isActive = true,
	showCursor = true,
	prompt = "> ",
	continuationIndent = "  ",
	columns,
}: MultilineTextInputProps) {
	const [cursorIndex, setCursorIndex] = useState(value.length)

	// Use refs to track the latest values for use in the useInput callback.
	// This prevents stale closure issues when multiple keystrokes arrive
	// faster than React can re-render.
	const valueRef = useRef(value)
	const cursorIndexRef = useRef(cursorIndex)

	// Keep refs in sync with state/props - these updates are synchronous
	valueRef.current = value
	cursorIndexRef.current = cursorIndex

	// Clamp cursor if value changes externally
	useEffect(() => {
		if (cursorIndex > value.length) {
			setCursorIndex(value.length)
		}
	}, [value, cursorIndex])

	// Handle keyboard input
	useInput(
		(input: string, key: Key) => {
			// Read from refs to get the latest values, not stale closure captures
			const currentValue = valueRef.current
			const currentCursorIndex = cursorIndexRef.current

			// Escape: clear all
			if (key.escape) {
				onEscape?.()
				return
			}

			// Ctrl+C: ignore (handled elsewhere)
			if (key.ctrl && input === "c") {
				return
			}

			// Ctrl+Enter: add new line
			if (key.return && key.ctrl) {
				const newValue =
					currentValue.slice(0, currentCursorIndex) + "\n" + currentValue.slice(currentCursorIndex)
				const newCursorIndex = currentCursorIndex + 1
				// Update refs immediately for next keystroke
				valueRef.current = newValue
				cursorIndexRef.current = newCursorIndex
				onChange(newValue)
				setCursorIndex(newCursorIndex)
				return
			}

			// Enter (without Ctrl): submit
			if (key.return) {
				onSubmit?.(currentValue)
				return
			}

			// Tab: ignore for now
			if (key.tab) {
				return
			}

			// Arrow up: move cursor up one line, or trigger history if on first line
			if (key.upArrow) {
				if (!showCursor) return
				const lines = currentValue.split("\n")
				const { line, col } = getCursorPosition(currentValue, currentCursorIndex)

				if (line > 0) {
					// Move to previous line
					const targetLine = lines[line - 1]!
					const newCol = Math.min(col, targetLine.length)
					const newCursorIndex = getIndexFromPosition(currentValue, line - 1, newCol)
					cursorIndexRef.current = newCursorIndex
					setCursorIndex(newCursorIndex)
				} else {
					// On first line - trigger history navigation callback
					onUpAtFirstLine?.()
				}
				return
			}

			// Arrow down: move cursor down one line, or trigger history if on last line
			if (key.downArrow) {
				if (!showCursor) return
				const lines = currentValue.split("\n")
				const { line, col } = getCursorPosition(currentValue, currentCursorIndex)

				if (line < lines.length - 1) {
					// Move to next line
					const targetLine = lines[line + 1]!
					const newCol = Math.min(col, targetLine.length)
					const newCursorIndex = getIndexFromPosition(currentValue, line + 1, newCol)
					cursorIndexRef.current = newCursorIndex
					setCursorIndex(newCursorIndex)
				} else {
					// On last line - trigger history navigation callback
					onDownAtLastLine?.()
				}
				return
			}

			// Arrow left: move cursor left
			if (key.leftArrow) {
				if (!showCursor) return
				const newCursorIndex = Math.max(0, currentCursorIndex - 1)
				cursorIndexRef.current = newCursorIndex
				setCursorIndex(newCursorIndex)
				return
			}

			// Arrow right: move cursor right
			if (key.rightArrow) {
				if (!showCursor) return
				const newCursorIndex = Math.min(currentValue.length, currentCursorIndex + 1)
				cursorIndexRef.current = newCursorIndex
				setCursorIndex(newCursorIndex)
				return
			}

			// Backspace/Delete
			if (key.backspace || key.delete) {
				if (currentCursorIndex > 0) {
					const newValue =
						currentValue.slice(0, currentCursorIndex - 1) + currentValue.slice(currentCursorIndex)
					const newCursorIndex = currentCursorIndex - 1
					// Update refs immediately for next keystroke
					valueRef.current = newValue
					cursorIndexRef.current = newCursorIndex
					onChange(newValue)
					setCursorIndex(newCursorIndex)
				}
				return
			}

			// Normal character input
			if (input) {
				const normalized = normalizeLineEndings(input)
				const newValue =
					currentValue.slice(0, currentCursorIndex) + normalized + currentValue.slice(currentCursorIndex)
				const newCursorIndex = currentCursorIndex + normalized.length
				// Update refs immediately for next keystroke
				valueRef.current = newValue
				cursorIndexRef.current = newCursorIndex
				onChange(newValue)
				setCursorIndex(newCursorIndex)
			}
		},
		{ isActive },
	)

	// Split value into lines for rendering
	const lines = useMemo(() => {
		if (!value && !isActive) {
			return [placeholder]
		}
		if (!value) {
			return [""]
		}
		return value.split("\n")
	}, [value, placeholder, isActive])

	// Determine which line and column the cursor is on
	const cursorPosition = useMemo(() => {
		if (!showCursor || !isActive) return null
		return getCursorPosition(value, cursorIndex)
	}, [value, cursorIndex, showCursor, isActive])

	// Calculate visual rows with wrapping
	const visualRows = useMemo(() => {
		const rows: VisualRow[] = []
		const promptLen = prompt.length
		const indentLen = continuationIndent.length

		for (let i = 0; i < lines.length; i++) {
			const lineText = lines[i]!
			const prefixLen = i === 0 ? promptLen : indentLen
			// Calculate available width for text (terminal width minus prefix)
			// Use a large number if columns is not provided
			const availableWidth = columns ? Math.max(1, columns - prefixLen) : 10000

			const lineRows = wrapLine(lineText, i, availableWidth)
			rows.push(...lineRows)
		}

		return rows
	}, [lines, columns, prompt.length, continuationIndent.length])

	// Render a visual row with optional cursor
	const renderVisualRow = useCallback(
		(row: VisualRow, rowIndex: number) => {
			const isPlaceholder = !value && !isActive && row.logicalLineIndex === 0
			const isFirstLine = row.logicalLineIndex === 0
			// Only show prefix on the first visual row of each logical line
			const linePrefix = row.isFirstRowOfLine ? (isFirstLine ? prompt : continuationIndent) : ""
			// Pad continuation rows to align with the text
			const padding = !row.isFirstRowOfLine ? (isFirstLine ? prompt : continuationIndent) : ""

			// Check if cursor is on this visual row
			let hasCursor = false
			let cursorColInRow = -1

			if (cursorPosition && cursorPosition.line === row.logicalLineIndex && isActive) {
				const cursorCol = cursorPosition.col
				// Check if cursor falls within this visual row's range
				if (cursorCol >= row.startCol && cursorCol < row.startCol + row.text.length) {
					hasCursor = true
					cursorColInRow = cursorCol - row.startCol
				}
				// Cursor at the end of this row (for the last row of a line)
				else if (cursorCol === row.startCol + row.text.length) {
					// Check if this is the last visual row for this logical line
					const nextRow = visualRows[rowIndex + 1]
					if (!nextRow || nextRow.logicalLineIndex !== row.logicalLineIndex) {
						hasCursor = true
						cursorColInRow = row.text.length
					}
				}
			}

			if (hasCursor) {
				const beforeCursor = row.text.slice(0, cursorColInRow)
				const cursorChar = row.text[cursorColInRow] || " "
				const afterCursor = row.text.slice(cursorColInRow + 1)

				return (
					<Box key={rowIndex}>
						<Text dimColor={!isFirstLine || !row.isFirstRowOfLine}>{linePrefix || padding}</Text>
						<Text>{beforeCursor}</Text>
						<Text inverse>{cursorChar}</Text>
						<Text>{afterCursor}</Text>
					</Box>
				)
			}

			return (
				<Box key={rowIndex}>
					<Text dimColor={!isFirstLine || !row.isFirstRowOfLine}>{linePrefix || padding}</Text>
					<Text dimColor={isPlaceholder}>{row.text}</Text>
				</Box>
			)
		},
		[prompt, continuationIndent, cursorPosition, value, isActive, visualRows],
	)

	return <Box flexDirection="column">{visualRows.map((row, index) => renderVisualRow(row, index))}</Box>
}
