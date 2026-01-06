import { Box, Text, useApp, useInput } from "ink"
import { TextInput, Select } from "@inkjs/ui"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { EventEmitter } from "events"
import { randomUUID } from "crypto"

import { useCLIStore } from "./store.js"
import Header from "./components/Header.js"
import ChatHistoryItem from "./components/ChatHistoryItem.js"
import LoadingText from "./components/LoadingText.js"
import { HistoryTextInput } from "./components/HistoryTextInput.js"
import { useTerminalSize } from "./hooks/useTerminalSize.js"
import * as theme from "./utils/theme.js"
import type { AppProps, TUIMessage, PendingAsk, SayType, AskType, View } from "./types.js"

/**
 * Interface for the extension host that the TUI interacts with
 */
interface ExtensionHostInterface extends EventEmitter {
	activate(): Promise<void>
	runTask(prompt: string): Promise<void>
	sendToExtension(message: unknown): void
	dispose(): Promise<void>
}

export interface TUIAppProps extends AppProps {
	/** Extension host factory - allows dependency injection for testing */
	createExtensionHost: (options: ExtensionHostOptions) => ExtensionHostInterface
}

interface ExtensionHostOptions {
	mode: string
	reasoningEffort?: string
	apiProvider: string
	apiKey: string
	model: string
	workspacePath: string
	extensionPath: string
	verbose: boolean
	quiet: boolean
	nonInteractive: boolean
	disableOutput: boolean
}

/**
 * Determine the current view state based on messages and pending asks
 */
function getView(messages: TUIMessage[], pendingAsk: PendingAsk | null, isLoading: boolean): View {
	// If there's a pending ask requiring text input, show input
	if (pendingAsk?.type === "followup") {
		return "UserInput"
	}

	// If there's any pending ask (approval), don't show thinking
	if (pendingAsk) {
		return "UserInput"
	}

	// Initial state or empty - awaiting user input
	if (messages.length === 0) {
		return "UserInput"
	}

	const lastMessage = messages.at(-1)
	if (!lastMessage) {
		return "UserInput"
	}

	// User just sent a message, waiting for response
	if (lastMessage.role === "user") {
		return "AgentResponse"
	}

	// Assistant replied
	if (lastMessage.role === "assistant") {
		if (lastMessage.hasPendingToolCalls) {
			return "ToolUse"
		}

		// If loading, still waiting for more
		if (isLoading) {
			return "AgentResponse"
		}

		return "UserInput"
	}

	// Tool result received, waiting for next assistant response
	if (lastMessage.role === "tool") {
		return "AgentResponse"
	}

	return "Default"
}

/**
 * Full-width horizontal line component - responsive to terminal resize
 */
function HorizontalLine() {
	const { columns } = useTerminalSize()
	return <Text color={theme.borderColor}>{"─".repeat(columns)}</Text>
}

/**
 * Main TUI Application Component
 */
export function App({
	initialPrompt,
	workspacePath,
	extensionPath,
	apiProvider,
	apiKey,
	model,
	mode,
	nonInteractive,
	verbose,
	debug,
	exitOnComplete,
	reasoningEffort,
	createExtensionHost,
}: TUIAppProps) {
	const { exit } = useApp()

	// Zustand store
	const {
		messages,
		pendingAsk,
		isLoading,
		isComplete,
		hasStartedTask,
		error,
		addMessage,
		setPendingAsk,
		setLoading,
		setComplete,
		setHasStartedTask,
		setError,
	} = useCLIStore()

	const hostRef = useRef<ExtensionHostInterface | null>(null)

	// Track seen message timestamps to filter duplicates and the prompt echo
	const seenMessageIds = useRef<Set<string>>(new Set())
	const firstTextMessageSkipped = useRef(false)

	// Track Ctrl+C presses for "press again to exit" behavior
	const [showExitHint, setShowExitHint] = useState(false)
	const exitHintTimeout = useRef<NodeJS.Timeout | null>(null)
	const pendingExit = useRef(false)

	// Track whether user wants to type custom response for followup questions
	const [showCustomInput, setShowCustomInput] = useState(false)
	// Ref to track transition state (handles async state update timing)
	const isTransitioningToCustomInput = useRef(false)

	// Determine current view
	const view = getView(messages, pendingAsk, isLoading)

	// Display all messages including partial (streaming) ones
	// The store handles deduplication by ID, so partial messages get updated in place
	const displayMessages = useMemo(() => {
		return messages
	}, [messages])

	// Cleanup function
	const cleanup = useCallback(async () => {
		if (hostRef.current) {
			await hostRef.current.dispose()
			hostRef.current = null
		}
	}, [])

	// Handle Ctrl+C - require double press to exit
	// Using useInput to capture in raw mode (Ink intercepts SIGINT)
	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			if (pendingExit.current) {
				// Second press - exit immediately
				if (exitHintTimeout.current) {
					clearTimeout(exitHintTimeout.current)
				}
				cleanup().finally(() => {
					exit()
					process.exit(0)
				})
			} else {
				// First press - show hint and wait for second press
				pendingExit.current = true
				setShowExitHint(true)

				// Clear the hint and reset after 2 seconds
				exitHintTimeout.current = setTimeout(() => {
					pendingExit.current = false
					setShowExitHint(false)
					exitHintTimeout.current = null
				}, 2000)
			}
		}
	})

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (exitHintTimeout.current) {
				clearTimeout(exitHintTimeout.current)
			}
		}
	}, [])

	// Map extension say messages to TUI messages
	const handleSayMessage = useCallback(
		(ts: number, say: SayType, text: string, partial: boolean) => {
			const messageId = ts.toString()

			// Filter out internal messages we don't want to display
			// checkpoint_saved contains internal commit hashes
			// api_req_started is verbose technical info
			if (say === "checkpoint_saved") {
				return
			}
			if (say === "api_req_started" && !verbose) {
				return
			}

			// Skip user_feedback - we already display user messages via addMessage() in handleSubmit
			// The extension echoes user input as user_feedback which would cause duplicates
			if (say === "user_feedback") {
				seenMessageIds.current.add(messageId)
				return
			}

			// Skip the first "text" message - the extension echoes the user's prompt
			// We already display the user's message, so skip this echo
			if (say === "text" && !firstTextMessageSkipped.current) {
				firstTextMessageSkipped.current = true
				seenMessageIds.current.add(messageId)
				return
			}

			// Skip if we've already processed this message ID (except for streaming updates)
			if (seenMessageIds.current.has(messageId) && !partial) {
				return
			}

			// Map say type to role
			let role: TUIMessage["role"] = "assistant"
			let toolName: string | undefined
			let toolDisplayName: string | undefined
			let toolDisplayOutput: string | undefined

			if (say === "command_output") {
				// command_output is plain text output from a bash command
				role = "tool"
				toolName = "execute_command"
				toolDisplayName = "bash"
				toolDisplayOutput = text
			} else if (say === "tool") {
				role = "tool"
				// Try to parse tool info
				try {
					const toolInfo = JSON.parse(text)
					toolName = toolInfo.tool
					toolDisplayName = toolInfo.tool
					toolDisplayOutput = formatToolOutput(toolInfo)
				} catch {
					toolDisplayOutput = text
				}
			} else if (say === "reasoning" || say === "thinking") {
				role = "thinking"
			}

			// Track this message ID
			seenMessageIds.current.add(messageId)

			// For streaming updates, the store's addMessage handles updating existing messages by ID
			addMessage({
				id: messageId,
				role,
				content: text || "",
				toolName,
				toolDisplayName,
				toolDisplayOutput,
				partial,
				originalType: say,
			})
		},
		[addMessage, verbose],
	)

	// Handle extension ask messages
	const handleAskMessage = useCallback(
		(ts: number, ask: AskType, text: string, partial: boolean) => {
			const messageId = ts.toString()

			// For partial messages, just return
			if (partial) {
				return
			}

			// Skip if we've already processed this ask (e.g., already approved/rejected)
			if (seenMessageIds.current.has(messageId)) {
				return
			}

			// command_output asks are for streaming command output, not for user approval
			// They should NOT trigger a Y/N prompt
			if (ask === "command_output") {
				seenMessageIds.current.add(messageId)
				return
			}

			// completion_result is handled via the "taskComplete" event, not as a pending ask
			// It should show the text input for follow-up, not Y/N prompt
			if (ask === "completion_result") {
				// Mark task as complete - user can type follow-up
				seenMessageIds.current.add(messageId)
				setComplete(true)
				setLoading(false)
				return
			}

			// In non-interactive mode, auto-approval is handled by extension settings
			if (nonInteractive && ask !== "followup") {
				// Show the action being taken
				seenMessageIds.current.add(messageId)

				// For tool asks, parse and format nicely
				if (ask === "tool") {
					let toolName: string | undefined
					let toolDisplayName: string | undefined
					let toolDisplayOutput: string | undefined
					let formattedContent = text || ""

					try {
						const toolInfo = JSON.parse(text) as Record<string, unknown>
						toolName = toolInfo.tool as string
						toolDisplayName = toolInfo.tool as string
						toolDisplayOutput = formatToolOutput(toolInfo)
						formattedContent = formatToolAskMessage(toolInfo)
					} catch {
						// Use raw text if not valid JSON
					}

					addMessage({
						id: messageId,
						role: "tool",
						content: formattedContent,
						toolName,
						toolDisplayName,
						toolDisplayOutput,
						originalType: ask,
					})
				} else {
					addMessage({
						id: messageId,
						role: "assistant",
						content: text || "",
						originalType: ask,
					})
				}
				return
			}

			// Parse suggestions for followup questions and format tool asks
			let suggestions: Array<{ answer: string; mode?: string | null }> | undefined
			let questionText = text

			if (ask === "followup") {
				try {
					const data = JSON.parse(text)
					questionText = data.question || text
					suggestions = Array.isArray(data.suggest) ? data.suggest : undefined
				} catch {
					// Use raw text
				}
			} else if (ask === "tool") {
				// Parse tool JSON and format nicely
				try {
					const toolInfo = JSON.parse(text) as Record<string, unknown>
					questionText = formatToolAskMessage(toolInfo)
				} catch {
					// Use raw text if not valid JSON
				}
			}

			// Mark as seen BEFORE setting pendingAsk to prevent re-processing
			seenMessageIds.current.add(messageId)

			// Set pending ask to show approval prompt
			setPendingAsk({
				id: messageId,
				type: ask,
				content: questionText,
				suggestions,
			})
		},
		[addMessage, setPendingAsk, setComplete, setLoading, nonInteractive],
	)

	// Handle extension messages
	const handleExtensionMessage = useCallback(
		(message: unknown) => {
			const msg = message as Record<string, unknown>

			if (msg.type === "state") {
				const state = msg.state as Record<string, unknown>
				if (!state) return

				const clineMessages = state.clineMessages as Array<Record<string, unknown>> | undefined
				if (clineMessages) {
					for (const clineMsg of clineMessages) {
						const ts = clineMsg.ts as number
						const type = clineMsg.type as string
						const say = clineMsg.say as SayType | undefined
						const ask = clineMsg.ask as AskType | undefined
						const text = (clineMsg.text as string) || ""
						const partial = (clineMsg.partial as boolean) || false

						if (type === "say" && say) {
							handleSayMessage(ts, say, text, partial)
						} else if (type === "ask" && ask) {
							handleAskMessage(ts, ask, text, partial)
						}
					}
				}
			} else if (msg.type === "messageUpdated") {
				const clineMessage = msg.clineMessage as Record<string, unknown>
				if (!clineMessage) return

				const ts = clineMessage.ts as number
				const type = clineMessage.type as string
				const say = clineMessage.say as SayType | undefined
				const ask = clineMessage.ask as AskType | undefined
				const text = (clineMessage.text as string) || ""
				const partial = (clineMessage.partial as boolean) || false

				if (type === "say" && say) {
					handleSayMessage(ts, say, text, partial)
				} else if (type === "ask" && ask) {
					handleAskMessage(ts, ask, text, partial)
				}
			}
		},
		[handleSayMessage, handleAskMessage],
	)

	// Initialize extension host
	useEffect(() => {
		const init = async () => {
			try {
				const host = createExtensionHost({
					mode,
					reasoningEffort: reasoningEffort === "unspecified" ? undefined : reasoningEffort,
					apiProvider,
					apiKey,
					model,
					workspacePath,
					extensionPath,
					verbose: debug,
					quiet: !verbose && !debug,
					nonInteractive,
					disableOutput: true, // TUI mode - Ink handles all rendering
				})

				hostRef.current = host

				// Listen for extension messages
				host.on("extensionWebviewMessage", handleExtensionMessage)

				// Listen for task completion
				host.on("taskComplete", async () => {
					setComplete(true)
					setLoading(false)
					if (exitOnComplete) {
						await cleanup()
						exit()
						setTimeout(() => process.exit(0), 100)
					}
				})

				// Listen for errors
				host.on("taskError", (err: string) => {
					setError(err)
					setLoading(false)
				})

				// Activate the extension
				await host.activate()
				setLoading(false)

				// Only run task automatically if we have an initial prompt
				if (initialPrompt) {
					setHasStartedTask(true)
					setLoading(true)
					// Add user message for the initial prompt
					addMessage({
						id: randomUUID(),
						role: "user",
						content: initialPrompt,
					})
					await host.runTask(initialPrompt)
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				setLoading(false)
			}
		}

		init()

		return () => {
			cleanup()
		}
	}, []) // Run once on mount

	// Handle user input submission
	const handleSubmit = useCallback(
		async (text: string) => {
			if (!hostRef.current || !text.trim()) return

			const trimmedText = text.trim()

			// Guard: don't submit the special "__CUSTOM__" value from Select
			if (trimmedText === "__CUSTOM__") {
				return
			}

			if (pendingAsk) {
				// Add user message to chat history
				addMessage({
					id: randomUUID(),
					role: "user",
					content: trimmedText,
				})

				// Send as response to ask
				hostRef.current.sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})
				setPendingAsk(null)
				setShowCustomInput(false)
				isTransitioningToCustomInput.current = false
				setLoading(true) // Show "Thinking" while waiting for response
			} else if (!hasStartedTask) {
				// First message - start a new task
				setHasStartedTask(true)
				setLoading(true)

				// Add user message
				addMessage({
					id: randomUUID(),
					role: "user",
					content: trimmedText,
				})

				try {
					await hostRef.current.runTask(trimmedText)
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err))
					setLoading(false)
				}
			} else {
				// Send as follow-up message (resume task if it was complete)
				if (isComplete) {
					setComplete(false)
				}
				setLoading(true)

				addMessage({
					id: randomUUID(),
					role: "user",
					content: trimmedText,
				})

				hostRef.current.sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})
			}
		},
		[
			pendingAsk,
			hasStartedTask,
			isComplete,
			addMessage,
			setPendingAsk,
			setHasStartedTask,
			setLoading,
			setComplete,
			setError,
		],
	)

	// Handle approval (Y key)
	const handleApprove = useCallback(() => {
		if (!hostRef.current) return

		hostRef.current.sendToExtension({
			type: "askResponse",
			askResponse: "yesButtonClicked",
		})
		setPendingAsk(null)
		setLoading(true) // Show "Thinking" while waiting for response
	}, [setPendingAsk, setLoading])

	// Handle rejection (N key)
	const handleReject = useCallback(() => {
		if (!hostRef.current) return

		hostRef.current.sendToExtension({
			type: "askResponse",
			askResponse: "noButtonClicked",
		})
		setPendingAsk(null)
		setLoading(true) // Show "Thinking" while waiting for response
	}, [setPendingAsk, setLoading])

	// Handle Y/N input for approval prompts
	useInput((input) => {
		if (pendingAsk && pendingAsk.type !== "followup") {
			const lower = input.toLowerCase()
			if (lower === "y") {
				handleApprove()
			} else if (lower === "n") {
				handleReject()
			}
		}
	})

	// Error display
	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red" bold>
					Error: {error}
				</Text>
				<Text color="gray" dimColor>
					Press Ctrl+C to exit
				</Text>
			</Box>
		)
	}

	// Status bar message - shows exit hint or default text
	const statusBarMessage = showExitHint ? (
		<Text color="yellow">Press Ctrl+C again to exit</Text>
	) : (
		<Text color={theme.dimText}>↑↓ history • ? for shortcuts</Text>
	)

	return (
		<Box flexDirection="column">
			{/* Header with ASCII art */}
			<Header model={model} mode={mode} cwd={workspacePath} reasoningEffort={reasoningEffort} />

			{/* Message history - render all completed messages */}
			{displayMessages.map((message) => (
				<ChatHistoryItem key={message.id} message={message} />
			))}

			{/* Input area - with borders like Claude Code */}
			<Box flexDirection="column" marginTop={1}>
				{view === "UserInput" ? (
					pendingAsk?.type === "followup" ? (
						<Box flexDirection="column">
							<Text color={theme.rooHeader}>{pendingAsk.content}</Text>
							{pendingAsk.suggestions && pendingAsk.suggestions.length > 0 && !showCustomInput ? (
								<Box flexDirection="column" marginTop={1}>
									<HorizontalLine />
									<Select
										options={[
											...pendingAsk.suggestions.map((s) => ({
												label: s.answer,
												value: s.answer,
											})),
											{ label: "Type something...", value: "__CUSTOM__" },
										]}
										onChange={(value) => {
											// Guard: Ignore empty, undefined, or invalid values
											if (!value || typeof value !== "string") return

											// Guard: Ignore if we're already transitioning or showing custom input
											if (showCustomInput || isTransitioningToCustomInput.current) return

											if (value === "__CUSTOM__") {
												// Don't send any response - just switch to text input mode
												// Use ref to prevent race conditions during state update
												isTransitioningToCustomInput.current = true
												setShowCustomInput(true)
											} else if (value.trim()) {
												// Only submit valid non-empty values
												handleSubmit(value)
											}
										}}
									/>
									<HorizontalLine />
									<Text color={theme.dimText}>↑↓ navigate • Enter select</Text>
								</Box>
							) : (
								<Box flexDirection="column" marginTop={1}>
									<HorizontalLine />
									<Box>
										<Text color={theme.promptColor}>&gt; </Text>
										<TextInput
											placeholder="Type your response..."
											onSubmit={(text) => {
												// Only submit if there's actual text
												if (text && text.trim()) {
													handleSubmit(text)
													setShowCustomInput(false)
													isTransitioningToCustomInput.current = false
												}
											}}
										/>
									</Box>
									<HorizontalLine />
									{statusBarMessage}
								</Box>
							)}
						</Box>
					) : pendingAsk ? (
						<Box flexDirection="column">
							<Text color={theme.rooHeader}>{pendingAsk.content}</Text>
							<Text color={theme.dimText}>
								Press <Text color={theme.successColor}>Y</Text> to approve,{" "}
								<Text color={theme.errorColor}>N</Text> to reject
							</Text>
						</Box>
					) : isComplete ? (
						<Box flexDirection="column">
							<HorizontalLine />
							<Box>
								<Text color={theme.promptColor}>&gt; </Text>
								<HistoryTextInput
									placeholder="Type to continue..."
									onSubmit={handleSubmit}
									isActive={view === "UserInput"}
								/>
							</Box>
							<HorizontalLine />
							{statusBarMessage}
						</Box>
					) : (
						<Box flexDirection="column">
							<HorizontalLine />
							<Box>
								<Text color={theme.promptColor}>› </Text>
								<HistoryTextInput
									placeholder=""
									onSubmit={handleSubmit}
									isActive={view === "UserInput"}
								/>
							</Box>
							<HorizontalLine />
							{statusBarMessage}
						</Box>
					)
				) : view === "ToolUse" ? (
					<Box paddingX={1}>
						<LoadingText>Using tool</LoadingText>
					</Box>
				) : (
					<Box paddingX={1}>
						<LoadingText>Thinking</LoadingText>
					</Box>
				)}
			</Box>
		</Box>
	)
}

/**
 * Format tool output for display (used in the message body, header shows tool name separately)
 */
function formatToolOutput(toolInfo: Record<string, unknown>): string {
	const toolName = (toolInfo.tool as string) || "unknown"

	// Handle specific tool types with friendly formatting
	switch (toolName) {
		case "switchMode": {
			const mode = (toolInfo.mode as string) || "unknown"
			const reason = toolInfo.reason as string
			return `→ ${mode} mode${reason ? `\n  ${reason}` : ""}`
		}

		case "switch_mode": {
			const mode = (toolInfo.mode_slug as string) || (toolInfo.mode as string) || "unknown"
			const reason = toolInfo.reason as string
			return `→ ${mode} mode${reason ? `\n  ${reason}` : ""}`
		}

		case "execute_command": {
			const command = toolInfo.command as string
			return `$ ${command || "(no command)"}`
		}

		case "read_file": {
			const files = toolInfo.files as Array<{ path: string }> | undefined
			const path = toolInfo.path as string
			if (files && files.length > 0) {
				return files.map((f) => `📄 ${f.path}`).join("\n")
			}
			return `📄 ${path || "(no path)"}`
		}

		case "write_to_file": {
			const writePath = toolInfo.path as string
			return `📝 ${writePath || "(no path)"}`
		}

		case "apply_diff": {
			const diffPath = toolInfo.path as string
			return `✏️ ${diffPath || "(no path)"}`
		}

		case "search_files": {
			const searchPath = toolInfo.path as string
			const regex = toolInfo.regex as string
			return `🔍 "${regex}" in ${searchPath || "."}`
		}

		case "list_files": {
			const listPath = toolInfo.path as string
			const recursive = toolInfo.recursive as boolean
			return `📁 ${listPath || "."}${recursive ? " (recursive)" : ""}`
		}

		case "browser_action": {
			const action = toolInfo.action as string
			const url = toolInfo.url as string
			return `🌐 ${action || "action"}${url ? `: ${url}` : ""}`
		}

		case "attempt_completion": {
			const result = toolInfo.result as string
			if (result) {
				const truncated = result.length > 100 ? result.substring(0, 100) + "..." : result
				return `✅ ${truncated}`
			}
			return "✅ Task completed"
		}

		case "ask_followup_question": {
			const question = toolInfo.question as string
			return `❓ ${question || "(no question)"}`
		}

		case "new_task": {
			const taskMode = toolInfo.mode as string
			return `📋 Creating subtask${taskMode ? ` in ${taskMode} mode` : ""}`
		}

		default: {
			// Generic formatting - show params without the tool name (it's in the header)
			const params = Object.entries(toolInfo)
				.filter(([key]) => key !== "tool")
				.map(([key, value]) => {
					const displayValue = typeof value === "string" ? value : JSON.stringify(value)
					const truncated = displayValue.length > 100 ? displayValue.substring(0, 100) + "..." : displayValue
					return `${key}: ${truncated}`
				})
				.join("\n")
			return params || "(no parameters)"
		}
	}
}

/**
 * Format tool ask message for user approval prompt
 */
function formatToolAskMessage(toolInfo: Record<string, unknown>): string {
	const toolName = (toolInfo.tool as string) || "unknown"

	// Handle specific tool types with nice formatting for approval prompts
	switch (toolName) {
		case "switchMode":
		case "switch_mode": {
			const mode = (toolInfo.mode as string) || (toolInfo.mode_slug as string) || "unknown"
			const reason = toolInfo.reason as string
			return `Switch to ${mode} mode?${reason ? `\nReason: ${reason}` : ""}`
		}

		case "execute_command": {
			const command = toolInfo.command as string
			return `Run command?\n$ ${command || "(no command)"}`
		}

		case "read_file": {
			const files = toolInfo.files as Array<{ path: string }> | undefined
			const path = toolInfo.path as string
			if (files && files.length > 0) {
				return `Read ${files.length} file(s)?\n${files.map((f) => `  ${f.path}`).join("\n")}`
			}
			return `Read file: ${path || "(no path)"}`
		}

		case "write_to_file": {
			const writePath = toolInfo.path as string
			return `Write to file: ${writePath || "(no path)"}`
		}

		case "apply_diff": {
			const diffPath = toolInfo.path as string
			return `Apply changes to: ${diffPath || "(no path)"}`
		}

		case "browser_action": {
			const action = toolInfo.action as string
			const url = toolInfo.url as string
			return `Browser: ${action || "action"}${url ? ` - ${url}` : ""}`
		}

		default: {
			// Generic formatting for other tools
			const params = Object.entries(toolInfo)
				.filter(([key]) => key !== "tool")
				.map(([key, value]) => {
					const displayValue = typeof value === "string" ? value : JSON.stringify(value)
					const truncated = displayValue.length > 80 ? displayValue.substring(0, 80) + "..." : displayValue
					return `  ${key}: ${truncated}`
				})
				.join("\n")
			return `${toolName}${params ? `\n${params}` : ""}`
		}
	}
}
