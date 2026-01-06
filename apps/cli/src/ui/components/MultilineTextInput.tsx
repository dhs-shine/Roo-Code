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

import { useState, useEffect, useMemo, useCallback } from "react"
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
}: MultilineTextInputProps) {
	const [cursorIndex, setCursorIndex] = useState(value.length)

	// Clamp cursor if value changes externally
	useEffect(() => {
		if (cursorIndex > value.length) {
			setCursorIndex(value.length)
		}
	}, [value, cursorIndex])

	// Handle keyboard input
	useInput(
		(input: string, key: Key) => {
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
				const newValue = value.slice(0, cursorIndex) + "\n" + value.slice(cursorIndex)
				onChange(newValue)
				setCursorIndex(cursorIndex + 1)
				return
			}

			// Enter (without Ctrl): submit
			if (key.return) {
				onSubmit?.(value)
				return
			}

			// Tab: ignore for now
			if (key.tab) {
				return
			}

			// Arrow up: move cursor up one line, or trigger history if on first line
			if (key.upArrow) {
				if (!showCursor) return
				const lines = value.split("\n")
				const { line, col } = getCursorPosition(value, cursorIndex)

				if (line > 0) {
					// Move to previous line
					const targetLine = lines[line - 1]!
					const newCol = Math.min(col, targetLine.length)
					setCursorIndex(getIndexFromPosition(value, line - 1, newCol))
				} else {
					// On first line - trigger history navigation callback
					onUpAtFirstLine?.()
				}
				return
			}

			// Arrow down: move cursor down one line, or trigger history if on last line
			if (key.downArrow) {
				if (!showCursor) return
				const lines = value.split("\n")
				const { line, col } = getCursorPosition(value, cursorIndex)

				if (line < lines.length - 1) {
					// Move to next line
					const targetLine = lines[line + 1]!
					const newCol = Math.min(col, targetLine.length)
					setCursorIndex(getIndexFromPosition(value, line + 1, newCol))
				} else {
					// On last line - trigger history navigation callback
					onDownAtLastLine?.()
				}
				return
			}

			// Arrow left: move cursor left
			if (key.leftArrow) {
				if (!showCursor) return
				setCursorIndex(Math.max(0, cursorIndex - 1))
				return
			}

			// Arrow right: move cursor right
			if (key.rightArrow) {
				if (!showCursor) return
				setCursorIndex(Math.min(value.length, cursorIndex + 1))
				return
			}

			// Backspace/Delete
			if (key.backspace || key.delete) {
				if (cursorIndex > 0) {
					const newValue = value.slice(0, cursorIndex - 1) + value.slice(cursorIndex)
					onChange(newValue)
					setCursorIndex(cursorIndex - 1)
				}
				return
			}

			// Normal character input
			if (input) {
				const normalized = normalizeLineEndings(input)
				const newValue = value.slice(0, cursorIndex) + normalized + value.slice(cursorIndex)
				onChange(newValue)
				setCursorIndex(cursorIndex + normalized.length)
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

	// Render a line with optional cursor
	const renderLine = useCallback(
		(lineText: string, lineIndex: number) => {
			const isPlaceholder = !value && !isActive && lineIndex === 0
			const isFirstLine = lineIndex === 0
			const linePrefix = isFirstLine ? prompt : continuationIndent

			// Check if cursor is on this line
			if (cursorPosition && cursorPosition.line === lineIndex && isActive) {
				const { col } = cursorPosition
				const beforeCursor = lineText.slice(0, col)
				const cursorChar = lineText[col] || " "
				const afterCursor = lineText.slice(col + 1)

				return (
					<Box key={lineIndex}>
						<Text dimColor={!isFirstLine}>{linePrefix}</Text>
						<Text>{beforeCursor}</Text>
						<Text inverse>{cursorChar}</Text>
						<Text>{afterCursor}</Text>
					</Box>
				)
			}

			return (
				<Box key={lineIndex}>
					<Text dimColor={!isFirstLine}>{linePrefix}</Text>
					<Text dimColor={isPlaceholder}>{lineText}</Text>
				</Box>
			)
		},
		[prompt, continuationIndent, cursorPosition, value, isActive],
	)

	return <Box flexDirection="column">{lines.map((line, index) => renderLine(line, index))}</Box>
}
