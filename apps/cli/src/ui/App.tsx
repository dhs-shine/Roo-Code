import { Box, Text, useApp, useInput } from "ink"
import { Select } from "@inkjs/ui"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { EventEmitter } from "events"
import { randomUUID } from "crypto"

import type { ClineMessage, TodoItem, WebviewMessage } from "@roo-code/types"
// Import only message-utils to avoid custom-tools dependencies (execa/child_process)
import { consolidateTokenUsage, consolidateApiRequests, consolidateCommands } from "@roo-code/core/message-utils"
import { toolInspectorLog, clearToolInspectorLog } from "../utils/toolInspectorLogger.js"
import { arePathsEqual } from "../utils/pathUtils.js"

import { useCLIStore } from "./store.js"
import { getContextWindow } from "../utils/getContextWindow.js"
import Header from "./components/Header.js"
import ChatHistoryItem from "./components/ChatHistoryItem.js"
import LoadingText from "./components/LoadingText.js"
import ToastDisplay from "./components/ToastDisplay.js"
import { useToast } from "./hooks/useToast.js"
import {
	AutocompleteInput,
	PickerSelect,
	createFileTrigger,
	createSlashCommandTrigger,
	createModeTrigger,
	createHelpTrigger,
	createHistoryTrigger,
	toFileResult,
	toSlashCommandResult,
	toModeResult,
	toHistoryResult,
	type AutocompleteInputHandle,
	type AutocompletePickerState,
	type AutocompleteTrigger,
	type FileResult,
	type SlashCommandResult as SlashCommandItem,
	type ModeResult as ModeItem,
	type HistoryResult,
} from "./components/autocomplete/index.js"
import { ScrollArea, useScrollToBottom } from "./components/ScrollArea.js"
import ScrollIndicator from "./components/ScrollIndicator.js"
import { TerminalSizeProvider, useTerminalSize } from "./hooks/TerminalSizeContext.js"
import * as theme from "./utils/theme.js"
import { matchesGlobalSequence } from "./utils/globalInputSequences.js"
import { FOLLOWUP_TIMEOUT_SECONDS } from "../constants.js"
import type {
	AppProps,
	TUIMessage,
	PendingAsk,
	SayType,
	AskType,
	View,
	FileSearchResult,
	SlashCommandResult,
	ModeResult,
	TaskHistoryItem,
} from "./types.js"
import { getGlobalCommand, getGlobalCommandsForAutocomplete } from "../globalCommands.js"

// Layout constants
const PICKER_HEIGHT = 10 // Max height for picker when open

/**
 * Interface for the extension host that the TUI interacts with
 */
interface ExtensionHostInterface extends EventEmitter {
	activate(): Promise<void>
	runTask(prompt: string): Promise<void>
	sendToExtension(message: WebviewMessage): void
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
	ephemeral?: boolean
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
	ephemeral,
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
		availableModes,
		taskHistory,
		setFileSearchResults,
		setAllSlashCommands,
		setAvailableModes,
		setTaskHistory,
		currentMode,
		setCurrentMode,
		tokenUsage,
		routerModels,
		apiConfiguration,
		setTokenUsage,
		setRouterModels,
		setApiConfiguration,
		currentTodos,
		setTodos,
	} = useCLIStore()

	// Compute context window from router models and API configuration
	const contextWindow = useMemo(
		() => getContextWindow(routerModels, apiConfiguration),
		[routerModels, apiConfiguration],
	)

	const hostRef = useRef<ExtensionHostInterface | null>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteRef = useRef<AutocompleteInputHandle<any>>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const followupAutocompleteRef = useRef<AutocompleteInputHandle<any>>(null)

	// Stable refs for autocomplete data - prevents useMemo from recreating triggers on every data change
	const fileSearchResultsRef = useRef(fileSearchResults)
	const allSlashCommandsRef = useRef(allSlashCommands)
	const availableModesRef = useRef(availableModes)
	const taskHistoryRef = useRef(taskHistory)

	// Keep refs in sync with current state
	useEffect(() => {
		fileSearchResultsRef.current = fileSearchResults
	}, [fileSearchResults])
	useEffect(() => {
		allSlashCommandsRef.current = allSlashCommands
	}, [allSlashCommands])
	useEffect(() => {
		availableModesRef.current = availableModes
	}, [availableModes])
	useEffect(() => {
		taskHistoryRef.current = taskHistory
	}, [taskHistory])

	// Track seen message timestamps to filter duplicates and the prompt echo
	const seenMessageIds = useRef<Set<string>>(new Set())
	const firstTextMessageSkipped = useRef(false)

	// Track Ctrl+C presses for "press again to exit" behavior
	const [showExitHint, setShowExitHint] = useState(false)
	const exitHintTimeout = useRef<NodeJS.Timeout | null>(null)
	const pendingExit = useRef(false)

	// Countdown timer for auto-accepting followup questions
	const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null)
	const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)

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

	// Toast notifications for ephemeral messages (e.g., mode changes)
	const { currentToast, showInfo } = useToast()

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

	// File search handler for the file trigger.
	const handleFileSearch = useCallback((query: string) => {
		if (!hostRef.current) {
			return
		}

		hostRef.current.sendToExtension({ type: "searchFiles", query })
	}, [])

	// Create autocomplete triggers
	// Using 'any' to allow mixing different trigger types (FileResult, SlashCommandResult, ModeResult, HelpShortcutResult, HistoryResult)
	// IMPORTANT: We use refs here to avoid recreating triggers every time data changes.
	// This prevents the UI flash caused by: data change -> memo recreation -> re-render with stale state
	// The getResults/getCommands/getModes/getHistory callbacks always read from refs to get fresh data.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteTriggers = useMemo((): AutocompleteTrigger<any>[] => {
		const fileTrigger = createFileTrigger({
			onSearch: handleFileSearch,
			getResults: () => {
				const results = fileSearchResultsRef.current
				return results.map(toFileResult)
			},
		})

		const slashCommandTrigger = createSlashCommandTrigger({
			getCommands: () => {
				// Merge CLI global commands with extension commands
				const extensionCommands = allSlashCommandsRef.current.map(toSlashCommandResult)
				const globalCommands = getGlobalCommandsForAutocomplete().map(toSlashCommandResult)
				// Global commands appear first, then extension commands
				return [...globalCommands, ...extensionCommands]
			},
		})

		const modeTrigger = createModeTrigger({
			getModes: () => availableModesRef.current.map(toModeResult),
		})

		const helpTrigger = createHelpTrigger()

		// History trigger - type # to search and resume previous tasks
		const historyTrigger = createHistoryTrigger({
			getHistory: () => {
				// Filter to only show tasks for the current workspace
				// Use arePathsEqual for proper cross-platform path comparison
				// (handles trailing slashes, separators, and case sensitivity)
				const history = taskHistoryRef.current
				const filtered = history.filter((item) => arePathsEqual(item.workspace, workspacePath))
				return filtered.map(toHistoryResult)
			},
		})

		return [fileTrigger, slashCommandTrigger, modeTrigger, helpTrigger, historyTrigger]
	}, [handleFileSearch, workspacePath]) // Only depend on handleFileSearch and workspacePath - data accessed via refs

	// Handle Ctrl+C, Tab for focus switching, Escape to cancel task, and Ctrl+M for mode cycling
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

		// Ctrl+M to cycle through modes (only when not loading and we have available modes)
		// Uses centralized global input sequence detection
		if (matchesGlobalSequence(input, key, "ctrl-m")) {
			// Don't allow mode switching while a task is in progress (loading)
			if (isLoading) {
				showInfo("Cannot switch modes while task is in progress", 2000)
				return
			}

			// Need at least 2 modes to cycle
			if (availableModes.length < 2) {
				return
			}

			// Find current mode index
			const currentModeSlug = currentMode || mode
			const currentIndex = availableModes.findIndex((m) => m.slug === currentModeSlug)
			const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % availableModes.length
			const nextMode = availableModes[nextIndex]

			if (nextMode && hostRef.current) {
				// Send mode change to extension
				hostRef.current.sendToExtension({ type: "switchMode", mode: nextMode.slug })
				// Show toast notification with the mode name
				showInfo(`Switched to ${nextMode.name}`, 2000)
			}
			return
		}

		// Escape key to cancel/pause task when loading (streaming)
		if (key.escape && isLoading && hostRef.current) {
			// If picker is open, let the picker handle escape first
			if (pickerState.isOpen) {
				return
			}
			// Send cancel message to extension (same as webview-ui Cancel button)
			hostRef.current.sendToExtension({ type: "cancelTask" })
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
			if (countdownIntervalRef.current) {
				clearInterval(countdownIntervalRef.current)
			}
		}
	}, [])

	// Countdown timer for auto-accepting followup questions
	// Start countdown when a followup question with suggestions appears
	useEffect(() => {
		// Clear any existing countdown
		if (countdownIntervalRef.current) {
			clearInterval(countdownIntervalRef.current)
			countdownIntervalRef.current = null
		}

		// Only start countdown for followup questions with suggestions (not custom input mode)
		if (
			pendingAsk?.type === "followup" &&
			pendingAsk.suggestions &&
			pendingAsk.suggestions.length > 0 &&
			!showCustomInput
		) {
			// Start countdown
			setCountdownSeconds(FOLLOWUP_TIMEOUT_SECONDS)

			countdownIntervalRef.current = setInterval(() => {
				setCountdownSeconds((prev) => {
					if (prev === null || prev <= 1) {
						// Time's up! Auto-select first option
						if (countdownIntervalRef.current) {
							clearInterval(countdownIntervalRef.current)
							countdownIntervalRef.current = null
						}
						// Auto-submit the first suggestion
						if (pendingAsk?.suggestions && pendingAsk.suggestions.length > 0) {
							const firstSuggestion = pendingAsk.suggestions[0]
							if (firstSuggestion) {
								handleSubmit(firstSuggestion.answer)
							}
						}
						return null
					}
					return prev - 1
				})
			}, 1000)
		} else {
			// No countdown needed
			setCountdownSeconds(null)
		}

		return () => {
			if (countdownIntervalRef.current) {
				clearInterval(countdownIntervalRef.current)
				countdownIntervalRef.current = null
			}
		}
	}, [pendingAsk?.id, pendingAsk?.type, showCustomInput]) // Re-run when pendingAsk changes or user switches to custom input

	// Refresh search results when fileSearchResults changes while file picker is open
	// This handles the async timing where API results arrive after initial search
	// IMPORTANT: Only run when fileSearchResults array identity changes (new API response)
	// We use a ref to track this and avoid depending on pickerState in the effect
	const prevFileSearchResultsRef = useRef(fileSearchResults)
	const pickerStateRef = useRef(pickerState)
	pickerStateRef.current = pickerState

	useEffect(() => {
		// Only run if fileSearchResults actually changed (different array reference)
		if (fileSearchResults === prevFileSearchResultsRef.current) {
			return
		}
		prevFileSearchResultsRef.current = fileSearchResults

		// Read pickerState from ref to avoid dependency
		const currentPickerState = pickerStateRef.current

		// Only refresh when file picker is open and we have new results
		if (
			currentPickerState.isOpen &&
			currentPickerState.activeTrigger?.id === "file" &&
			fileSearchResults.length > 0
		) {
			autocompleteRef.current?.refreshSearch()
			followupAutocompleteRef.current?.refreshSearch()
		}
	}, [fileSearchResults]) // Only depend on fileSearchResults - read pickerState from ref

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

					// Log tool payload for inspection
					toolInspectorLog("say:tool", {
						ts,
						rawText: text,
						parsedToolInfo: toolInfo,
						partial,
					})

					toolName = toolInfo.tool
					toolDisplayName = toolInfo.tool
					toolDisplayOutput = formatToolOutput(toolInfo)

					// Special handling for update_todo_list tool
					if (toolName === "update_todo_list" || toolName === "updateTodoList") {
						const todos = parseTodosFromToolInfo(toolInfo)
						if (todos && todos.length > 0) {
							// Capture previous todos before updating
							const prevTodos = [...currentTodos]
							setTodos(todos)

							seenMessageIds.current.add(messageId)

							addMessage({
								id: messageId,
								role: "tool",
								content: text || "",
								toolName,
								toolDisplayName,
								toolDisplayOutput,
								partial,
								originalType: say,
								todos,
								previousTodos: prevTodos,
							})
							return
						}
					}
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
		[addMessage, verbose, currentTodos, setTodos],
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

			// Handle resume_task and resume_completed_task - stop loading and show text input
			// Do not set pendingAsk - just stop loading so user sees normal input to type new message
			if (ask === "resume_task" || ask === "resume_completed_task") {
				seenMessageIds.current.add(messageId)
				setLoading(false)
				// Mark that a task has been started so subsequent messages continue the task
				// (instead of starting a brand new task via runTask)
				setHasStartedTask(true)
				// Do not set pendingAsk - let the normal text input appear
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

						// Log tool payload for inspection (nonInteractive ask)
						toolInspectorLog("ask:tool:nonInteractive", {
							ts,
							rawText: text,
							parsedToolInfo: toolInfo,
							partial,
						})

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

					// Log tool payload for inspection (interactive ask)
					toolInspectorLog("ask:tool:interactive", {
						ts,
						rawText: text,
						parsedToolInfo: toolInfo,
						partial,
					})

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

				// Extract and update current mode from state
				const newMode = state.mode as string | undefined
				if (newMode) {
					setCurrentMode(newMode)
				}

				// Extract and update task history from state
				const newTaskHistory = state.taskHistory as TaskHistoryItem[] | undefined
				if (newTaskHistory && Array.isArray(newTaskHistory)) {
					setTaskHistory(newTaskHistory)
				}

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

					// Compute token usage metrics from clineMessages
					// Skip first message (task prompt) as per webview UI pattern
					if (clineMessages.length > 1) {
						const processed = consolidateApiRequests(
							consolidateCommands(clineMessages.slice(1) as ClineMessage[]),
						)
						const metrics = consolidateTokenUsage(processed)
						setTokenUsage(metrics)
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
			} else if (msg.type === "modes") {
				const modes =
					(msg.modes as Array<{
						slug: string
						name: string
						description?: string
					}>) || []
				const modeResults: ModeResult[] = modes.map((mode) => ({
					slug: mode.slug,
					name: mode.name,
					description: mode.description,
				}))
				setAvailableModes(modeResults)
			} else if (msg.type === "routerModels") {
				// Handle router models for context window lookup
				const models = msg.models as Record<string, Record<string, { contextWindow?: number }>> | undefined
				if (models) {
					setRouterModels(models)
				}
			} else if (msg.type === "apiConfiguration") {
				// Handle API configuration for model identification
				const config = msg.configuration as unknown
				if (config) {
					setApiConfiguration(config as import("@roo-code/types").ProviderSettings)
				}
			}
		},
		[
			handleSayMessage,
			handleAskMessage,
			setFileSearchResults,
			setAllSlashCommands,
			setAvailableModes,
			setCurrentMode,
			setTokenUsage,
			setRouterModels,
			setApiConfiguration,
			setTaskHistory,
		],
	)

	// Initialize extension host
	useEffect(() => {
		const init = async () => {
			// Clear tool inspector log for fresh session
			clearToolInspectorLog()

			toolInspectorLog("session:start", {
				timestamp: new Date().toISOString(),
				mode,
				nonInteractive,
			})

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
					ephemeral,
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

				// Request initial state from extension (triggers postStateToWebview which includes taskHistory)
				host.sendToExtension({ type: "webviewDidLaunch" })
				host.sendToExtension({ type: "requestCommands" })
				host.sendToExtension({ type: "requestModes" })

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

	const handleSubmit = useCallback(
		async (text: string) => {
			if (!hostRef.current || !text.trim()) {
				return
			}

			const trimmedText = text.trim()

			if (trimmedText === "__CUSTOM__") {
				return
			}

			// Check for CLI global action commands (e.g., /new).
			if (trimmedText.startsWith("/")) {
				const commandMatch = trimmedText.match(/^\/(\w+)(?:\s|$)/)

				if (commandMatch && commandMatch[1]) {
					const globalCommand = getGlobalCommand(commandMatch[1])

					if (globalCommand?.action === "clearTask") {
						// Reset CLI state and send clearTask to extension.
						useCLIStore.getState().reset()
						// Reset component-level refs to avoid stale message tracking.
						seenMessageIds.current.clear()
						firstTextMessageSkipped.current = false
						hostRef.current.sendToExtension({ type: "clearTask" })
						// Re-request state, commands and modes since reset() cleared them.
						hostRef.current.sendToExtension({ type: "webviewDidLaunch" })
						hostRef.current.sendToExtension({ type: "requestCommands" })
						hostRef.current.sendToExtension({ type: "requestModes" })
						return
					}
				}
			}

			if (pendingAsk) {
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

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
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

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
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

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
		if (!hostRef.current) {
			return
		}

		hostRef.current.sendToExtension({ type: "askResponse", askResponse: "yesButtonClicked" })
		setPendingAsk(null)
		setLoading(true)
	}, [setPendingAsk, setLoading])

	// Handle rejection (N key)
	const handleReject = useCallback(() => {
		if (!hostRef.current) {
			return
		}

		hostRef.current.sendToExtension({ type: "askResponse", askResponse: "noButtonClicked" })
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

	// Cancel countdown timer when user navigates in the followup suggestion menu
	// This provides better UX - any user interaction cancels the auto-accept timer
	const showFollowupSuggestions =
		pendingAsk?.type === "followup" &&
		pendingAsk.suggestions &&
		pendingAsk.suggestions.length > 0 &&
		!showCustomInput

	useInput((_input, key) => {
		// Only handle when followup suggestions are shown and countdown is active
		if (showFollowupSuggestions && countdownSeconds !== null) {
			// Cancel countdown on any arrow key navigation
			if (key.upArrow || key.downArrow) {
				if (countdownIntervalRef.current) {
					clearInterval(countdownIntervalRef.current)
					countdownIntervalRef.current = null
				}
				setCountdownSeconds(null)
			}
		}
	})

	// Handle picker state changes from AutocompleteInput
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const handlePickerStateChange = useCallback((state: AutocompletePickerState<any>) => setPickerState(state), [])

	// Handle item selection from external PickerSelect
	const handlePickerSelect = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(item: any) => {
			// Check if this is a mode selection
			if (pickerState.activeTrigger?.id === "mode" && item && typeof item === "object" && "slug" in item) {
				const modeItem = item as ModeItem

				// Send mode change message to extension
				if (hostRef.current) {
					hostRef.current.sendToExtension({ type: "switchMode", mode: modeItem.slug })
				}

				// Close the picker
				autocompleteRef.current?.closePicker()
				followupAutocompleteRef.current?.closePicker()
			}
			// Check if this is a history item selection
			else if (pickerState.activeTrigger?.id === "history" && item && typeof item === "object" && "id" in item) {
				const historyItem = item as HistoryResult

				// Don't allow task switching while a task is in progress (loading)
				if (isLoading) {
					showInfo("Cannot switch tasks while task is in progress", 2000)
					// Close the picker
					autocompleteRef.current?.closePicker()
					followupAutocompleteRef.current?.closePicker()
					return
				}

				// Send showTaskWithId message to extension to resume the task
				if (hostRef.current) {
					// Reset CLI state before resuming task
					useCLIStore.getState().reset()
					seenMessageIds.current.clear()
					firstTextMessageSkipped.current = false

					// Send message to resume the selected task
					hostRef.current.sendToExtension({ type: "showTaskWithId", text: historyItem.id })

					// Re-request state, commands and modes since reset() cleared them
					hostRef.current.sendToExtension({ type: "webviewDidLaunch" })
					hostRef.current.sendToExtension({ type: "requestCommands" })
					hostRef.current.sendToExtension({ type: "requestModes" })
				}

				// Close the picker
				autocompleteRef.current?.closePicker()
				followupAutocompleteRef.current?.closePicker()
			} else {
				// Handle other item selections normally
				autocompleteRef.current?.handleItemSelect(item)
				followupAutocompleteRef.current?.handleItemSelect(item)
			}
		},
		[pickerState.activeTrigger, isLoading, showInfo],
	)

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
	// Priority: Toast > Exit hint > Loading > Scroll indicator > Input hint
	// Don't show spinner when waiting for user input (pendingAsk is set)
	const statusBarMessage = currentToast ? (
		<ToastDisplay toast={currentToast} />
	) : showExitHint ? (
		<Text color="yellow">Press Ctrl+C again to exit</Text>
	) : isLoading && !pendingAsk ? (
		<Box>
			<LoadingText>{view === "ToolUse" ? "Using tool" : "Thinking"}</LoadingText>
			<Text color={theme.dimText}> • </Text>
			<Text color={theme.dimText}>Esc to cancel</Text>
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
	) : isInputAreaActive ? (
		<Text color={theme.dimText}>? for shortcuts • Ctrl+M mode</Text>
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
					mode={currentMode || mode}
					cwd={workspacePath}
					reasoningEffort={reasoningEffort}
					version={version}
					tokenUsage={tokenUsage}
					contextWindow={contextWindow}
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
											// Clear countdown timer synchronously BEFORE state update
											// This prevents race condition where interval fires before useEffect cleanup
											if (countdownIntervalRef.current) {
												clearInterval(countdownIntervalRef.current)
												countdownIntervalRef.current = null
											}
											setCountdownSeconds(null)
											isTransitioningToCustomInput.current = true
											setShowCustomInput(true)
										} else if (value.trim()) {
											handleSubmit(value)
										}
									}}
								/>
								<HorizontalLine active={true} />
								<Text color={theme.dimText}>
									↑↓ navigate • Enter select
									{countdownSeconds !== null && (
										<Text color="yellow"> • Auto-select in {countdownSeconds}s</Text>
									)}
								</Text>
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
											isLoading={pickerState.isLoading}
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
									isLoading={pickerState.isLoading}
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

		case "update_todo_list":
		case "updateTodoList": {
			// Special marker - actual rendering is handled by TodoChangeDisplay component
			return "☑ TODO list updated"
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

/**
 * Parse TODO items from tool info
 * Handles both array format and markdown checklist string format
 */
function parseTodosFromToolInfo(toolInfo: Record<string, unknown>): TodoItem[] | null {
	// Try to get todos directly as an array
	const todosArray = toolInfo.todos as unknown[] | undefined
	if (Array.isArray(todosArray)) {
		return todosArray
			.map((item, index) => {
				if (typeof item === "object" && item !== null) {
					const todo = item as Record<string, unknown>
					return {
						id: (todo.id as string) || `todo-${index}`,
						content: (todo.content as string) || "",
						status: ((todo.status as string) || "pending") as TodoItem["status"],
					}
				}
				return null
			})
			.filter((item): item is TodoItem => item !== null)
	}

	// Try to parse markdown checklist format from todos string
	const todosString = toolInfo.todos as string | undefined
	if (typeof todosString === "string") {
		return parseMarkdownChecklist(todosString)
	}

	return null
}

/**
 * Parse a markdown checklist string into TodoItem array
 * Format:
 *   [ ] pending item
 *   [-] in progress item
 *   [x] completed item
 */
function parseMarkdownChecklist(markdown: string): TodoItem[] {
	const lines = markdown.split("\n")
	const todos: TodoItem[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		if (!line) {
			continue
		}

		const trimmedLine = line.trim()

		if (!trimmedLine) {
			continue
		}

		// Match markdown checkbox patterns
		const checkboxMatch = trimmedLine.match(/^\[([x\-\s])\]\s*(.+)$/i)

		if (checkboxMatch) {
			const statusChar = checkboxMatch[1] ?? " "
			const content = checkboxMatch[2] ?? ""
			let status: TodoItem["status"] = "pending"

			if (statusChar.toLowerCase() === "x") {
				status = "completed"
			} else if (statusChar === "-") {
				status = "in_progress"
			}

			todos.push({ id: `todo-${i}`, content: content.trim(), status })
		}
	}

	return todos
}
