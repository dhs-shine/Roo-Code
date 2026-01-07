import { memo } from "react"
import { Box, Newline, Text } from "ink"

import * as theme from "../utils/theme.js"
import type { TUIMessage } from "../types.js"
import TodoDisplay from "./TodoDisplay.js"

/**
 * Sanitize content for terminal display by:
 * - Replacing tab characters with spaces (tabs expand to variable widths in terminals)
 * - Stripping carriage returns that could cause display issues
 */
function sanitizeContent(text: string): string {
	return text.replace(/\t/g, "    ").replace(/\r/g, "")
}

interface ChatHistoryItemProps {
	message: TUIMessage
}

function ChatHistoryItem({ message }: ChatHistoryItemProps) {
	const content = sanitizeContent(message.content || "...")

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

			// Sanitize toolDisplayOutput if present, otherwise use already-sanitized content
			const toolContent = message.toolDisplayOutput ? sanitizeContent(message.toolDisplayOutput) : content

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
