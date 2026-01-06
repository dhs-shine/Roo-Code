import { Box, Text, useApp, useInput } from "ink"
import { Select } from "@inkjs/ui"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { EventEmitter } from "events"
import { randomUUID } from "crypto"

import { useCLIStore } from "./store.js"
import Header from "./components/Header.js"
import ChatHistoryItem from "./components/ChatHistoryItem.js"
import LoadingText from "./components/LoadingText.js"
import {
	AutocompleteInput,
	PickerSelect,
	createFileTrigger,
	createSlashCommandTrigger,
	toFileResult,
	toSlashCommandResult,
	type AutocompleteInputHandle,
	type AutocompletePickerState,
	type AutocompleteTrigger,
	type FileResult,
	type SlashCommandResult as SlashCommandItem,
} from "./components/autocomplete/index.js"
import { ScrollArea, useScrollToBottom } from "./components/ScrollArea.js"
import ScrollIndicator from "./components/ScrollIndicator.js"
import { TerminalSizeProvider, useTerminalSize } from "./hooks/TerminalSizeContext.js"
import * as theme from "./utils/theme.js"
import type {
	AppProps,
	TUIMessage,
	PendingAsk,
	SayType,
	AskType,
	View,
	FileSearchResult,
	SlashCommandResult,
} from "./types.js"

// Layout constants
const PICKER_HEIGHT = 10 // Max height for picker when open

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
 * Full-width horizontal line component - uses terminal size from context
 */
function HorizontalLine({ active = false }: { active?: boolean }) {
	const { columns } = useTerminalSize()
	const color = active ? theme.borderColorActive : theme.borderColor
	return <Text color={color}>{"─".repeat(columns)}</Text>
}

/**
 * Inner App component that uses the terminal size context
 */
function AppInner({
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
	version,
}: TUIAppProps) {
	const { exit } = useApp()

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
		fileSearchResults,
		allSlashCommands,
		setFileSearchResults,
		setAllSlashCommands,
	} = useCLIStore()

	const hostRef = useRef<ExtensionHostInterface | null>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteRef = useRef<AutocompleteInputHandle<any>>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const followupAutocompleteRef = useRef<AutocompleteInputHandle<any>>(null)

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

	// Manual focus override: 'scroll' | 'input' | null (null = auto-determine)
	const [manualFocus, setManualFocus] = useState<"scroll" | "input" | null>(null)

	// Autocomplete picker state (received from AutocompleteInput via callback)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const [pickerState, setPickerState] = useState<AutocompletePickerState<any>>({
		activeTrigger: null,
		results: [],
		selectedIndex: 0,
		isOpen: false,
		isLoading: false,
		triggerInfo: null,
	})

	// Scroll area state
	const { rows } = useTerminalSize()
	const [scrollState, setScrollState] = useState({ scrollTop: 0, maxScroll: 0, isAtBottom: true })
	const { scrollToBottomTrigger, scrollToBottom } = useScrollToBottom()

	// Determine current view
	const view = getView(messages, pendingAsk, isLoading)

	// Determine if we should show the approval prompt (Y/N) instead of text input
	const showApprovalPrompt = pendingAsk && pendingAsk.type !== "followup"

	// Determine if we're in a mode where focus can be toggled (text input is available)
	const canToggleFocus =
		!showApprovalPrompt &&
		(!pendingAsk || // Initial input or task complete or loading
			pendingAsk.type === "followup" || // Followup question with suggestions or custom input
			showCustomInput) // Custom input mode

	// Determine if scroll area should capture keyboard input
	const isScrollAreaActive: boolean =
		manualFocus === "scroll" ? true : manualFocus === "input" ? false : Boolean(showApprovalPrompt)

	// Determine if input area is active (for visual focus indicator)
	const isInputAreaActive: boolean =
		manualFocus === "input" ? true : manualFocus === "scroll" ? false : !showApprovalPrompt

	// Reset manual focus when view changes (e.g., agent starts responding)
	useEffect(() => {
		if (!canToggleFocus) {
			setManualFocus(null)
		}
	}, [canToggleFocus])

	// Display all messages including partial (streaming) ones
	const displayMessages = useMemo(() => {
		return messages
	}, [messages])

	// Scroll to bottom when new messages arrive (if auto-scroll is enabled)
	const prevMessageCount = useRef(messages.length)
	useEffect(() => {
		if (messages.length > prevMessageCount.current && scrollState.isAtBottom) {
			scrollToBottom()
		}
		prevMessageCount.current = messages.length
	}, [messages.length, scrollState.isAtBottom, scrollToBottom])

	// Handle scroll state changes from ScrollArea
	const handleScroll = useCallback((scrollTop: number, maxScroll: number, isAtBottom: boolean) => {
		setScrollState({ scrollTop, maxScroll, isAtBottom })
	}, [])

	// Cleanup function
	const cleanup = useCallback(async () => {
		if (hostRef.current) {
			await hostRef.current.dispose()
			hostRef.current = null
		}
	}, [])

	// File search handler for the file trigger
	const handleFileSearch = useCallback((query: string) => {
		if (!hostRef.current) return
		hostRef.current.sendToExtension({
			type: "searchFiles",
			query,
		})
	}, [])

	// Create autocomplete triggers
	// Using 'any' to allow mixing different trigger types (FileResult, SlashCommandResult)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteTriggers = useMemo((): AutocompleteTrigger<any>[] => {
		const fileTrigger = createFileTrigger({
			onSearch: handleFileSearch,
			getResults: () => fileSearchResults.map(toFileResult),
		})

		const slashCommandTrigger = createSlashCommandTrigger({
			getCommands: () => allSlashCommands.map(toSlashCommandResult),
		})

		return [fileTrigger, slashCommandTrigger]
	}, [handleFileSearch, fileSearchResults, allSlashCommands])

	// Handle Ctrl+C and Tab for focus switching
	useInput((input, key) => {
		// Tab to toggle focus between scroll area and input (only when input is available)
		if (key.tab && canToggleFocus && !pickerState.isOpen) {
			setManualFocus((prev) => {
				if (prev === "scroll") return "input"
				if (prev === "input") return "scroll"
				return isScrollAreaActive ? "input" : "scroll"
			})
			return
		}

		if (key.ctrl && input === "c") {
			// If picker is open, close it first
			if (pickerState.isOpen) {
				autocompleteRef.current?.closePicker()
				followupAutocompleteRef.current?.closePicker()
				return
			}

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

			if (say === "checkpoint_saved") {
				return
			}
			if (say === "api_req_started" && !verbose) {
				return
			}

			if (say === "user_feedback") {
				seenMessageIds.current.add(messageId)
				return
			}

			if (say === "text" && !firstTextMessageSkipped.current) {
				firstTextMessageSkipped.current = true
				seenMessageIds.current.add(messageId)
				return
			}

			if (seenMessageIds.current.has(messageId) && !partial) {
				return
			}

			let role: TUIMessage["role"] = "assistant"
			let toolName: string | undefined
			let toolDisplayName: string | undefined
			let toolDisplayOutput: string | undefined

			if (say === "command_output") {
				role = "tool"
				toolName = "execute_command"
				toolDisplayName = "bash"
				toolDisplayOutput = text
			} else if (say === "tool") {
				role = "tool"
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

			seenMessageIds.current.add(messageId)

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

			if (partial) {
				return
			}

			if (seenMessageIds.current.has(messageId)) {
				return
			}

			if (ask === "command_output") {
				seenMessageIds.current.add(messageId)
				return
			}

			if (ask === "completion_result") {
				seenMessageIds.current.add(messageId)
				setComplete(true)
				setLoading(false)
				return
			}

			if (nonInteractive && ask !== "followup") {
				seenMessageIds.current.add(messageId)

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
				try {
					const toolInfo = JSON.parse(text) as Record<string, unknown>
					questionText = formatToolAskMessage(toolInfo)
				} catch {
					// Use raw text if not valid JSON
				}
			}

			seenMessageIds.current.add(messageId)

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
			} else if (msg.type === "fileSearchResults") {
				const results = (msg.results as FileSearchResult[]) || []
				setFileSearchResults(results)
			} else if (msg.type === "commands") {
				const commands =
					(msg.commands as Array<{
						name: string
						description?: string
						argumentHint?: string
						source: "global" | "project" | "built-in"
					}>) || []
				const slashCommands: SlashCommandResult[] = commands.map((cmd) => ({
					name: cmd.name,
					description: cmd.description,
					argumentHint: cmd.argumentHint,
					source: cmd.source,
				}))
				setAllSlashCommands(slashCommands)
			}
		},
		[handleSayMessage, handleAskMessage, setFileSearchResults, setAllSlashCommands],
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
					disableOutput: true,
				})

				hostRef.current = host

				host.on("extensionWebviewMessage", handleExtensionMessage)

				host.on("taskComplete", async () => {
					setComplete(true)
					setLoading(false)
					if (exitOnComplete) {
						await cleanup()
						exit()
						setTimeout(() => process.exit(0), 100)
					}
				})

				host.on("taskError", (err: string) => {
					setError(err)
					setLoading(false)
				})

				await host.activate()

				host.sendToExtension({ type: "requestCommands" })

				setLoading(false)

				if (initialPrompt) {
					setHasStartedTask(true)
					setLoading(true)
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

			if (trimmedText === "__CUSTOM__") {
				return
			}

			if (pendingAsk) {
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
				setPendingAsk(null)
				setShowCustomInput(false)
				isTransitioningToCustomInput.current = false
				setLoading(true)
			} else if (!hasStartedTask) {
				setHasStartedTask(true)
				setLoading(true)

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
		setLoading(true)
	}, [setPendingAsk, setLoading])

	// Handle rejection (N key)
	const handleReject = useCallback(() => {
		if (!hostRef.current) return

		hostRef.current.sendToExtension({
			type: "askResponse",
			askResponse: "noButtonClicked",
		})
		setPendingAsk(null)
		setLoading(true)
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

	// Handle picker state changes from AutocompleteInput
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const handlePickerStateChange = useCallback((state: AutocompletePickerState<any>) => {
		setPickerState(state)
	}, [])

	// Handle item selection from external PickerSelect
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const handlePickerSelect = useCallback((item: any) => {
		autocompleteRef.current?.handleItemSelect(item)
		followupAutocompleteRef.current?.handleItemSelect(item)
	}, [])

	// Handle picker close from external PickerSelect
	const handlePickerClose = useCallback(() => {
		autocompleteRef.current?.closePicker()
		followupAutocompleteRef.current?.closePicker()
	}, [])

	// Handle picker index change from external PickerSelect
	const handlePickerIndexChange = useCallback((index: number) => {
		autocompleteRef.current?.handleIndexChange(index)
		followupAutocompleteRef.current?.handleIndexChange(index)
	}, [])

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

	// Status bar content
	const statusBarMessage = showExitHint ? (
		<Text color="yellow">Press Ctrl+C again to exit</Text>
	) : isLoading ? (
		<Box>
			<LoadingText>{view === "ToolUse" ? "Using tool" : "Thinking"}</LoadingText>
			{isScrollAreaActive && (
				<>
					<Text color={theme.dimText}> • </Text>
					<ScrollIndicator
						scrollTop={scrollState.scrollTop}
						maxScroll={scrollState.maxScroll}
						isScrollFocused={true}
					/>
				</>
			)}
		</Box>
	) : isScrollAreaActive ? (
		<ScrollIndicator scrollTop={scrollState.scrollTop} maxScroll={scrollState.maxScroll} isScrollFocused={true} />
	) : null

	// Get render function for picker items based on active trigger
	const getPickerRenderItem = () => {
		if (pickerState.activeTrigger) {
			return pickerState.activeTrigger.renderItem
		}
		// Default render
		return (item: FileResult | SlashCommandItem, isSelected: boolean) => (
			<Box paddingLeft={2}>
				<Text color={isSelected ? "cyan" : undefined}>{item.key}</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" height={rows - 1}>
			{/* Header - fixed size */}
			<Box flexShrink={0}>
				<Header
					model={model}
					mode={mode}
					cwd={workspacePath}
					reasoningEffort={reasoningEffort}
					version={version}
				/>
			</Box>

			{/* Scrollable message history area - fills remaining space via flexGrow */}
			<ScrollArea
				isActive={isScrollAreaActive}
				onScroll={handleScroll}
				scrollToBottomTrigger={scrollToBottomTrigger}>
				{displayMessages.map((message) => (
					<ChatHistoryItem key={message.id} message={message} />
				))}
			</ScrollArea>

			{/* Input area - with borders like Claude Code - fixed size */}
			<Box flexDirection="column" flexShrink={0}>
				{pendingAsk?.type === "followup" ? (
					<Box flexDirection="column">
						<Text color={theme.rooHeader}>{pendingAsk.content}</Text>
						{pendingAsk.suggestions && pendingAsk.suggestions.length > 0 && !showCustomInput ? (
							<Box flexDirection="column" marginTop={1}>
								<HorizontalLine active={true} />
								<Select
									options={[
										...pendingAsk.suggestions.map((s) => ({
											label: s.answer,
											value: s.answer,
										})),
										{ label: "Type something...", value: "__CUSTOM__" },
									]}
									onChange={(value) => {
										if (!value || typeof value !== "string") return
										if (showCustomInput || isTransitioningToCustomInput.current) return

										if (value === "__CUSTOM__") {
											isTransitioningToCustomInput.current = true
											setShowCustomInput(true)
										} else if (value.trim()) {
											handleSubmit(value)
										}
									}}
								/>
								<HorizontalLine active={true} />
								<Text color={theme.dimText}>↑↓ navigate • Enter select</Text>
							</Box>
						) : (
							<Box flexDirection="column" marginTop={1}>
								<HorizontalLine active={isInputAreaActive} />
								<AutocompleteInput
									ref={followupAutocompleteRef}
									placeholder="Type your response..."
									onSubmit={(text: string) => {
										if (text && text.trim()) {
											handleSubmit(text)
											setShowCustomInput(false)
											isTransitioningToCustomInput.current = false
										}
									}}
									isActive={true}
									triggers={autocompleteTriggers}
									onPickerStateChange={handlePickerStateChange}
									prompt="> "
								/>
								<HorizontalLine active={isInputAreaActive} />
								{pickerState.isOpen ? (
									<Box flexDirection="column" height={PICKER_HEIGHT}>
										<PickerSelect
											results={pickerState.results}
											selectedIndex={pickerState.selectedIndex}
											maxVisible={PICKER_HEIGHT - 1}
											onSelect={handlePickerSelect}
											onEscape={handlePickerClose}
											onIndexChange={handlePickerIndexChange}
											renderItem={getPickerRenderItem()}
											emptyMessage={pickerState.activeTrigger?.emptyMessage}
											isActive={isInputAreaActive && pickerState.isOpen}
										/>
									</Box>
								) : (
									<Box height={1}>{statusBarMessage}</Box>
								)}
							</Box>
						)}
					</Box>
				) : showApprovalPrompt ? (
					<Box flexDirection="column">
						<Text color={theme.rooHeader}>{pendingAsk?.content}</Text>
						<Text color={theme.dimText}>
							Press <Text color={theme.successColor}>Y</Text> to approve,{" "}
							<Text color={theme.errorColor}>N</Text> to reject
						</Text>
						<Box height={1}>{statusBarMessage}</Box>
					</Box>
				) : (
					<Box flexDirection="column">
						<HorizontalLine active={isInputAreaActive} />
						<AutocompleteInput
							ref={autocompleteRef}
							placeholder={isComplete ? "Type to continue..." : ""}
							onSubmit={handleSubmit}
							isActive={isInputAreaActive}
							triggers={autocompleteTriggers}
							onPickerStateChange={handlePickerStateChange}
							prompt="› "
						/>
						<HorizontalLine active={isInputAreaActive} />
						{pickerState.isOpen ? (
							<Box flexDirection="column" height={PICKER_HEIGHT}>
								<PickerSelect
									results={pickerState.results}
									selectedIndex={pickerState.selectedIndex}
									maxVisible={PICKER_HEIGHT - 1}
									onSelect={handlePickerSelect}
									onEscape={handlePickerClose}
									onIndexChange={handlePickerIndexChange}
									renderItem={getPickerRenderItem()}
									emptyMessage={pickerState.activeTrigger?.emptyMessage}
									isActive={isInputAreaActive && pickerState.isOpen}
								/>
							</Box>
						) : (
							<Box height={1}>{statusBarMessage}</Box>
						)}
					</Box>
				)}
			</Box>
		</Box>
	)
}

/**
 * Main TUI Application Component - wraps with TerminalSizeProvider
 */
export function App(props: TUIAppProps) {
	return (
		<TerminalSizeProvider>
			<AppInner {...props} />
		</TerminalSizeProvider>
	)
}

/**
 * Format tool output for display (used in the message body, header shows tool name separately)
 */
function formatToolOutput(toolInfo: Record<string, unknown>): string {
	const toolName = (toolInfo.tool as string) || "unknown"

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
