import { memo } from "react"
import { Box, Text } from "ink"

import type { TodoItem } from "@roo-code/types"

import * as theme from "../utils/theme.js"
import ProgressBar from "./ProgressBar.js"

/**
 * Status icons for TODO items using Unicode characters
 */
const STATUS_ICONS = {
	completed: "✓",
	in_progress: "→",
	pending: "○",
} as const

/**
 * Get the color for a TODO status
 */
function getStatusColor(status: TodoItem["status"]): string {
	switch (status) {
		case "completed":
			return theme.successColor
		case "in_progress":
			return theme.warningColor
		case "pending":
		default:
			return theme.dimText
	}
}

interface TodoDisplayProps {
	/** List of TODO items to display */
	todos: TodoItem[]
	/** Previous TODO list for diff comparison (optional) */
	previousTodos?: TodoItem[]
	/** Whether to show the progress bar (default: true) */
	showProgress?: boolean
	/** Whether to show only changed items (default: false) */
	showChangesOnly?: boolean
	/** Title to display in the header (default: "TODO List Updated") */
	title?: string
}

/**
 * TodoDisplay component for CLI
 *
 * Renders a beautiful TODO list visualization with:
 * - Status icons (✓ completed, → in progress, ○ pending)
 * - Color-coded items based on status
 * - Progress bar showing completion percentage
 * - Optional diff mode showing only changed items
 *
 * Visual example:
 * ```
 * ┌─ TODO List Updated ──────────────────────────────┐
 * │  ✓ Analyze requirements                          │
 * │  ✓ Design architecture                           │
 * │  → Implement core logic                          │
 * │  ○ Write tests                                   │
 * │  ○ Update documentation                          │
 * │  [████████░░░░░░░░] 2/5 completed                │
 * └──────────────────────────────────────────────────┘
 * ```
 */
function TodoDisplay({
	todos,
	previousTodos = [],
	showProgress = true,
	showChangesOnly = false,
	title = "TODO List Updated",
}: TodoDisplayProps) {
	if (!todos || todos.length === 0) {
		return null
	}

	// Determine which todos to display
	let displayTodos: TodoItem[]

	if (showChangesOnly && previousTodos.length > 0) {
		// Filter to only show items that changed status
		displayTodos = todos.filter((todo) => {
			const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
			if (!previousTodo) {
				// New item
				return true
			}
			// Status changed
			return previousTodo.status !== todo.status
		})
	} else {
		displayTodos = todos
	}

	// If filtering and nothing changed, don't render
	if (showChangesOnly && displayTodos.length === 0) {
		return null
	}

	// Calculate progress statistics
	const totalCount = todos.length
	const completedCount = todos.filter((t) => t.status === "completed").length
	const inProgressCount = todos.filter((t) => t.status === "in_progress").length

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header */}
			<Box>
				<Text color={theme.toolHeader} bold>
					☑ {title}
				</Text>
			</Box>

			{/* Border top */}
			<Box>
				<Text color={theme.borderColor}>{"─".repeat(50)}</Text>
			</Box>

			{/* TODO items */}
			<Box flexDirection="column" paddingLeft={1}>
				{displayTodos.map((todo, index) => {
					const icon = STATUS_ICONS[todo.status] || STATUS_ICONS.pending
					const color = getStatusColor(todo.status)

					// Check if this item changed status
					const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
					const statusChanged = previousTodo && previousTodo.status !== todo.status
					const isNew = previousTodos.length > 0 && !previousTodo

					return (
						<Box key={todo.id || `todo-${index}`}>
							<Text color={color}>
								{icon} {todo.content}
							</Text>
							{statusChanged && (
								<Text color={theme.dimText} dimColor>
									{" "}
									[
									{todo.status === "completed"
										? "done"
										: todo.status === "in_progress"
											? "started"
											: "reset"}
									]
								</Text>
							)}
							{isNew && (
								<Text color={theme.dimText} dimColor>
									{" "}
									[new]
								</Text>
							)}
						</Box>
					)
				})}
			</Box>

			{/* Progress bar and stats */}
			{showProgress && (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color={theme.borderColor}>{"─".repeat(50)}</Text>
					</Box>
					<Box paddingLeft={1}>
						<ProgressBar value={completedCount} max={totalCount} width={16} />
						<Text color={theme.dimText}>
							{" "}
							{completedCount}/{totalCount} completed
							{inProgressCount > 0 && `, ${inProgressCount} in progress`}
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	)
}

export default memo(TodoDisplay)
