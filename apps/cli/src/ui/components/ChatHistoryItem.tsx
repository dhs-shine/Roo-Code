import { memo } from "react"
import { Box, Newline, Text } from "ink"

import * as theme from "../utils/theme.js"
import type { TUIMessage } from "../types.js"
import TodoDisplay from "./TodoDisplay.js"

interface ChatHistoryItemProps {
	message: TUIMessage
}

function ChatHistoryItem({ message }: ChatHistoryItemProps) {
	const content = message.content || "..."

	switch (message.role) {
		case "user":
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text bold color="magenta">
						You said:
					</Text>
					<Text color={theme.userText}>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		case "assistant":
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text bold color="yellow">
						Roo said:
					</Text>
					<Text color={theme.rooText}>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		case "thinking":
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text bold color={theme.thinkingHeader} dimColor>
						Roo is thinking:
					</Text>
					<Text color={theme.thinkingText} dimColor>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		case "tool": {
			// Special rendering for update_todo_list tool - show full TODO list
			if (
				(message.toolName === "update_todo_list" || message.toolName === "updateTodoList") &&
				message.todos &&
				message.todos.length > 0
			) {
				return (
					<Box flexDirection="column">
						<TodoDisplay todos={message.todos} previousTodos={message.previousTodos} showProgress={true} />
						<Text>
							<Newline />
						</Text>
					</Box>
				)
			}

			let toolContent = message.toolDisplayOutput || content

			// Replace tab characters with spaces to prevent terminal width miscalculation
			// Tabs expand to variable widths in terminals, causing layout issues
			toolContent = toolContent.replace(/\t/g, "    ")

			// Also strip any carriage returns that could cause issues
			toolContent = toolContent.replace(/\r/g, "")

			return (
				<Box flexDirection="column" paddingX={1}>
					<Text bold color={theme.toolHeader}>
						{`tool - ${message.toolDisplayName || message.toolName || "unknown"}`}
					</Text>
					<Text color={theme.toolText}>
						{toolContent}
						<Newline />
					</Text>
				</Box>
			)
		}
		case "system":
			// System messages are typically rendered as Header, not here.
			// But if they appear, show them subtly.
			return (
				<Box flexDirection="column" paddingX={1}>
					<Text color="gray" dimColor>
						{content}
						<Newline />
					</Text>
				</Box>
			)
		default:
			return null
	}
}

export default memo(ChatHistoryItem)
