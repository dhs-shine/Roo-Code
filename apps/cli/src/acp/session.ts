/**
 * ACP Session
 *
 * Manages a single ACP session, wrapping an ExtensionHost instance.
 * Handles message translation, event streaming, and permission requests.
 *
 * Commands are executed internally by the extension (like the reference
 * implementations gemini-cli and opencode), not through ACP terminals.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as acp from "@agentclientprotocol/sdk"
import type { ClineMessage, ClineAsk, ClineSay } from "@roo-code/types"

import { type ExtensionHostOptions, ExtensionHost } from "@/agent/extension-host.js"
import type { WaitingForInputEvent, TaskCompletedEvent } from "@/agent/events.js"

import {
	translateToAcpUpdate,
	isPermissionAsk,
	isCompletionAsk,
	extractPromptText,
	extractPromptImages,
	buildToolCallFromMessage,
} from "./translator.js"
import { acpLog } from "./logger.js"
import { DeltaTracker } from "./delta-tracker.js"
import { UpdateBuffer } from "./update-buffer.js"

// =============================================================================
// Streaming Configuration
// =============================================================================

/**
 * Configuration for streaming content types.
 * Defines which message types should be delta-streamed and how.
 */
interface StreamConfig {
	/** ACP update type to use */
	updateType: "agent_message_chunk" | "agent_thought_chunk"
	/** Optional transform to apply to the text before delta tracking */
	textTransform?: (text: string) => string
}

/**
 * Declarative configuration for which `say` types should be delta-streamed.
 * Any say type not listed here will fall through to the translator for
 * non-streaming handling.
 *
 * To add a new streaming type, simply add it to this map.
 */
const DELTA_STREAM_CONFIG: Partial<Record<ClineSay, StreamConfig>> = {
	// Regular text messages from the agent
	text: { updateType: "agent_message_chunk" },

	// Command output (terminal results, etc.)
	command_output: { updateType: "agent_message_chunk" },

	// Final completion summary
	completion_result: { updateType: "agent_message_chunk" },

	// Agent's reasoning/thinking
	reasoning: { updateType: "agent_thought_chunk" },

	// Error messages (prefixed with "Error: ")
	error: {
		updateType: "agent_message_chunk",
		textTransform: (text) => `Error: ${text}`,
	},
}

// =============================================================================
// Types
// =============================================================================

export interface AcpSessionOptions {
	/** Path to the extension bundle */
	extensionPath: string
	/** API provider */
	provider: string
	/** API key (optional, may come from environment) */
	apiKey?: string
	/** Model to use */
	model: string
	/** Initial mode */
	mode: string
}

// =============================================================================
// AcpSession Class
// =============================================================================

/**
 * AcpSession wraps an ExtensionHost instance and bridges it to the ACP protocol.
 *
 * Each ACP session creates its own ExtensionHost, which loads the extension
 * in a sandboxed environment. The session translates events from the
 * ExtensionClient to ACP session updates and handles permission requests.
 */
export class AcpSession {
	private pendingPrompt: AbortController | null = null
	private promptResolve: ((response: acp.PromptResponse) => void) | null = null
	private isProcessingPrompt = false

	/** Delta tracker for streaming content - ensures only new text is sent */
	private readonly deltaTracker = new DeltaTracker()

	/** Update buffer for batching session updates to reduce message frequency */
	private readonly updateBuffer: UpdateBuffer

	/**
	 * The current prompt text - used to filter out user message echo.
	 * When the extension receives a task, it often sends a `text` message
	 * containing the user's input, which we should NOT echo back to ACP
	 * since the client already displays the user's message.
	 */
	private currentPromptText: string | null = null

	/**
	 * Track pending command tool calls to send proper status updates.
	 * Maps tool call ID to command info for the "Run Command" UI.
	 */
	private pendingCommandCalls: Map<string, { toolCallId: string; command: string; ts: number }> = new Map()

	/** Workspace path for resolving relative file paths */
	private readonly workspacePath: string

	private constructor(
		private readonly sessionId: string,
		private readonly extensionHost: ExtensionHost,
		private readonly connection: acp.AgentSideConnection,
		workspacePath: string,
	) {
		this.workspacePath = workspacePath
		// Initialize update buffer with the actual send function
		// Uses defaults: 200 chars min buffer, 500ms delay
		this.updateBuffer = new UpdateBuffer((update) => this.sendUpdateDirect(update))
	}

	// ===========================================================================
	// Factory Method
	// ===========================================================================

	/**
	 * Create a new AcpSession.
	 *
	 * This initializes an ExtensionHost for the given working directory
	 * and sets up event handlers to stream updates to the ACP client.
	 */
	static async create(
		sessionId: string,
		cwd: string,
		connection: acp.AgentSideConnection,
		_clientCapabilities: acp.ClientCapabilities | undefined,
		options: AcpSessionOptions,
	): Promise<AcpSession> {
		acpLog.info("Session", `Creating session ${sessionId} in ${cwd}`)

		// Create ExtensionHost with ACP-specific configuration
		const hostOptions: ExtensionHostOptions = {
			mode: options.mode,
			user: null,
			provider: options.provider as ExtensionHostOptions["provider"],
			apiKey: options.apiKey,
			model: options.model,
			workspacePath: cwd,
			extensionPath: options.extensionPath,
			// ACP mode: disable direct output, we stream through ACP.
			disableOutput: true,
			// Don't persist state - ACP clients manage their own sessions.
			ephemeral: true,
		}

		acpLog.debug("Session", "Creating ExtensionHost", hostOptions)
		const extensionHost = new ExtensionHost(hostOptions)
		await extensionHost.activate()
		acpLog.info("Session", `ExtensionHost activated for session ${sessionId}`)

		const session = new AcpSession(sessionId, extensionHost, connection, cwd)
		session.setupEventHandlers()

		return session
	}

	// ===========================================================================
	// Event Handlers
	// ===========================================================================

	/**
	 * Set up event handlers to translate ExtensionClient events to ACP updates.
	 */
	private setupEventHandlers(): void {
		const client = this.extensionHost.client

		// Handle new messages
		client.on("message", (msg: ClineMessage) => {
			this.handleMessage(msg)
		})

		// Handle message updates (partial -> complete)
		client.on("messageUpdated", (msg: ClineMessage) => {
			this.handleMessage(msg)
		})

		// Handle permission requests (tool calls, commands, etc.)
		client.on("waitingForInput", (event: WaitingForInputEvent) => {
			void this.handleWaitingForInput(event)
		})

		// Handle task completion
		client.on("taskCompleted", (event: TaskCompletedEvent) => {
			this.handleTaskCompleted(event)
		})
	}

	/**
	 * Handle an incoming message from the extension.
	 *
	 * Uses the declarative DELTA_STREAM_CONFIG to automatically determine
	 * which message types should be delta-streamed and how.
	 */
	private handleMessage(message: ClineMessage): void {
		acpLog.debug(
			"Session",
			`Message received: type=${message.type}, say=${message.say}, ask=${message.ask}, ts=${message.ts}`,
		)

		// Check if this is a streaming message type
		if (message.type === "say" && message.text && message.say) {
			// Handle command_output specially for the "Run Command" UI
			if (message.say === "command_output") {
				this.handleCommandOutput(message)
				return
			}

			const config = DELTA_STREAM_CONFIG[message.say]

			if (config) {
				// Filter out user message echo: when the extension starts a task,
				// it often sends a `text` message with the user's input. Since the
				// ACP client already displays the user's message, we should skip this.
				if (message.say === "text" && this.isUserEcho(message.text)) {
					acpLog.debug("Session", `Skipping user echo (${message.text.length} chars)`)
					return
				}

				// Apply text transform if configured (e.g., "Error: " prefix)
				const textToSend = config.textTransform ? config.textTransform(message.text) : message.text

				// Get delta using the tracker (handles all bookkeeping automatically)
				const delta = this.deltaTracker.getDelta(message.ts, textToSend)

				if (delta) {
					acpLog.debug("Session", `Sending ${message.say} delta: ${delta.length} chars (msg ${message.ts})`)
					void this.sendUpdate({
						sessionUpdate: config.updateType,
						content: { type: "text", text: delta },
					})
				}
				return
			}
		}

		// For non-streaming message types, use the translator
		const update = translateToAcpUpdate(message)
		if (update) {
			acpLog.notification("sessionUpdate", {
				sessionId: this.sessionId,
				updateKind: (update as { sessionUpdate?: string }).sessionUpdate,
			})
			void this.sendUpdate(update)
		}
	}

	/**
	 * Handle command_output messages and update the corresponding tool call.
	 * This provides the "Run Command" UI with live output in Zed.
	 * Also streams output as agent_message_chunk for visibility in the main chat.
	 */
	private handleCommandOutput(message: ClineMessage): void {
		const output = message.text || ""
		const isPartial = message.partial === true

		acpLog.info("Session", `handleCommandOutput: partial=${message.partial}, text length=${output.length}`)
		acpLog.info("Session", `Pending command calls: ${this.pendingCommandCalls.size}`)

		// Always stream command output as agent message for visibility in chat
		const delta = this.deltaTracker.getDelta(message.ts, output)
		if (delta) {
			acpLog.info("Session", `Streaming command output as agent message: ${delta.length} chars`)
			void this.sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: delta },
			})
		}

		// Also update the tool call UI if we have a pending command
		const pendingCall = this.findMostRecentPendingCommand()

		if (pendingCall) {
			acpLog.info("Session", `Found pending call: ${pendingCall.toolCallId}, isPartial=${isPartial}`)

			if (isPartial) {
				// Still running - send update with current output
				void this.sendUpdate({
					sessionUpdate: "tool_call_update",
					toolCallId: pendingCall.toolCallId,
					status: "in_progress",
					content: [
						{
							type: "content",
							content: { type: "text", text: output },
						},
					],
				})
			} else {
				// Command completed - send final update and remove from pending
				void this.sendUpdate({
					sessionUpdate: "tool_call_update",
					toolCallId: pendingCall.toolCallId,
					status: "completed",
					content: [
						{
							type: "content",
							content: { type: "text", text: output },
						},
					],
					rawOutput: { output },
				})
				this.pendingCommandCalls.delete(pendingCall.toolCallId)
				acpLog.info("Session", `Command completed: ${pendingCall.toolCallId}`)
			}
		}
	}

	/**
	 * Find the most recent pending command call.
	 */
	private findMostRecentPendingCommand(): { toolCallId: string; command: string; ts: number } | undefined {
		let pendingCall: { toolCallId: string; command: string; ts: number } | undefined

		for (const [, call] of this.pendingCommandCalls) {
			if (!pendingCall || call.ts > pendingCall.ts) {
				pendingCall = call
			}
		}

		return pendingCall
	}

	/**
	 * Reset delta tracking and buffer for a new prompt.
	 */
	private resetForNewPrompt(): void {
		this.deltaTracker.reset()
		this.updateBuffer.reset()
	}

	/**
	 * Handle waiting for input events (permission requests).
	 */
	private async handleWaitingForInput(event: WaitingForInputEvent): Promise<void> {
		const { ask, message } = event
		const askType = ask as ClineAsk
		acpLog.debug("Session", `Waiting for input: ask=${askType}`)

		// Handle permission-required asks
		if (isPermissionAsk(askType)) {
			acpLog.info("Session", `Permission request: ${askType}`)
			await this.handlePermissionRequest(message, askType)
			return
		}

		// Handle completion asks
		if (isCompletionAsk(askType)) {
			acpLog.debug("Session", "Completion ask - handled by taskCompleted event")
			// Completion is handled by taskCompleted event
			return
		}

		// Handle followup questions - auto-continue for now
		// In a more sophisticated implementation, these could be surfaced
		// to the ACP client for user input
		if (askType === "followup") {
			acpLog.debug("Session", "Auto-responding to followup")
			this.extensionHost.client.respond("")
			return
		}

		// Handle resume_task - auto-resume
		if (askType === "resume_task") {
			acpLog.debug("Session", "Auto-approving resume_task")
			this.extensionHost.client.approve()
			return
		}

		// Handle API failures - auto-retry for now
		if (askType === "api_req_failed") {
			acpLog.warn("Session", "API request failed, auto-retrying")
			this.extensionHost.client.approve()
			return
		}

		// Default: approve and continue
		acpLog.debug("Session", `Auto-approving unknown ask type: ${askType}`)
		this.extensionHost.client.approve()
	}

	/**
	 * Handle a permission request for a tool call.
	 *
	 * Auto-approves all tool calls without prompting the user. This allows
	 * the agent to work autonomously. Tool calls are still reported to the
	 * client for visibility via tool_call notifications.
	 *
	 * For commands, tracks the call to enable the "Run Command" UI with output.
	 * For other tools (search, read, etc.), the results are already available
	 * in the message, so we send both the tool_call and tool_call_update immediately.
	 */
	private handlePermissionRequest(message: ClineMessage, ask: ClineAsk): void {
		const toolCall = buildToolCallFromMessage(message, this.workspacePath)
		const isCommand = ask === "command"

		// For commands, ensure kind is "execute" for the "Run Command" UI
		const kind = isCommand ? "execute" : toolCall.kind

		acpLog.info("Session", `Auto-approving tool: ${toolCall.title}, ask=${ask}, isCommand=${isCommand}`)
		acpLog.info("Session", `Tool call details: id=${toolCall.toolCallId}, kind=${kind}, title=${toolCall.title}`)
		acpLog.info("Session", `Tool call rawInput: ${JSON.stringify(toolCall.rawInput)}`)

		// Build the full update with corrected kind for commands
		const initialUpdate = {
			sessionUpdate: "tool_call" as const,
			...toolCall,
			kind,
			status: "in_progress" as const,
		}
		acpLog.info("Session", `Sending tool_call update: ${JSON.stringify(initialUpdate)}`)

		// Notify client about the tool call with in_progress status
		void this.sendUpdate(initialUpdate)

		// For commands, track the call for the "Run Command" UI
		// (completion will come via handleCommandOutput)
		if (isCommand) {
			this.pendingCommandCalls.set(toolCall.toolCallId, {
				toolCallId: toolCall.toolCallId,
				command: message.text || "",
				ts: message.ts,
			})
			acpLog.info("Session", `Tracking command: ${toolCall.toolCallId}`)
		} else {
			// For non-command tools (search, read, etc.), the results are already
			// available in the message. Send completion update immediately.
			const rawInput = toolCall.rawInput as Record<string, unknown>

			// Build completion update
			const completionUpdate: acp.SessionNotification["update"] = {
				sessionUpdate: "tool_call_update",
				toolCallId: toolCall.toolCallId,
				status: "completed",
				rawOutput: rawInput,
			}

			// For edit operations with diff content, use the pre-parsed diff from toolCall
			if (kind === "edit" && toolCall.content && toolCall.content.length > 0) {
				acpLog.info("Session", `Edit tool with ${toolCall.content.length} content items (diffs)`)
				completionUpdate.content = toolCall.content
			} else {
				// For search, read, etc. - extract and format text content
				const rawContent = this.extractContentFromRawInput(rawInput)
				acpLog.info("Session", `Non-edit tool content: ${rawContent ? `${rawContent.length} chars` : "none"}`)

				if (rawContent) {
					const formattedContent = this.formatToolResultContent(kind ?? "other", rawContent)
					completionUpdate.content = [
						{
							type: "content",
							content: { type: "text", text: formattedContent },
						},
					]
				}
			}

			acpLog.info("Session", `Sending tool_call_update (completed): ${toolCall.toolCallId}`)
			void this.sendUpdate(completionUpdate)
		}

		// Auto-approve the tool call
		this.extensionHost.client.approve()
	}

	/**
	 * Maximum number of lines to show in read operation results.
	 * Files longer than this will be truncated with a "..." indicator.
	 */
	private static readonly MAX_READ_LINES = 100

	/**
	 * Format tool result content for cleaner display in the UI.
	 *
	 * - For search tools: formats verbose results into a clean file list with summary
	 * - For read tools: truncates long file contents
	 * - Both search and read results are wrapped in code blocks for better rendering
	 * - For other tools: returns the content as-is
	 */
	private formatToolResultContent(kind: string, content: string): string {
		switch (kind) {
			case "search":
				return this.wrapInCodeBlock(this.formatSearchResults(content))
			case "read":
				return this.wrapInCodeBlock(this.formatReadResults(content))
			default:
				return content
		}
	}

	/**
	 * Extract content from rawInput.
	 *
	 * For readFile tools, the "content" field contains the file PATH (not contents),
	 * so we need to read the file ourselves.
	 *
	 * For other tools, try common field names for content.
	 */
	private extractContentFromRawInput(rawInput: Record<string, unknown>): string | undefined {
		const toolName = (rawInput.tool as string | undefined)?.toLowerCase() || ""

		// For readFile tools, read the actual file content
		if (toolName === "readfile" || toolName === "read_file") {
			return this.readFileContent(rawInput)
		}

		// For other tools, try common field names
		const contentFields = ["content", "text", "result", "output", "fileContent", "data"]

		for (const field of contentFields) {
			const value = rawInput[field]
			if (typeof value === "string" && value.length > 0) {
				return value
			}
		}

		return undefined
	}

	/**
	 * Read file content for readFile tool operations.
	 * The rawInput.content field contains the absolute path, not the file contents.
	 */
	private readFileContent(rawInput: Record<string, unknown>): string | undefined {
		// The "content" field in readFile contains the absolute path
		const filePath = rawInput.content as string | undefined
		const relativePath = rawInput.path as string | undefined

		// Try absolute path first, then relative path
		const pathToRead = filePath || (relativePath ? path.resolve(this.workspacePath, relativePath) : undefined)

		if (!pathToRead) {
			acpLog.warn("Session", "readFile tool has no path")
			return undefined
		}

		try {
			const content = fs.readFileSync(pathToRead, "utf-8")
			acpLog.info("Session", `Read file content: ${content.length} chars from ${pathToRead}`)
			return content
		} catch (error) {
			acpLog.error("Session", `Failed to read file ${pathToRead}: ${error}`)
			return `Error reading file: ${error}`
		}
	}

	/**
	 * Wrap content in markdown code block for better rendering.
	 */
	private wrapInCodeBlock(content: string): string {
		return "```\n" + content + "\n```"
	}

	/**
	 * Format read results by truncating long file contents.
	 */
	private formatReadResults(content: string): string {
		const lines = content.split("\n")

		if (lines.length <= AcpSession.MAX_READ_LINES) {
			return content
		}

		// Truncate and add indicator
		const truncated = lines.slice(0, AcpSession.MAX_READ_LINES).join("\n")
		const remaining = lines.length - AcpSession.MAX_READ_LINES
		return `${truncated}\n\n... (${remaining} more lines)`
	}

	/**
	 * Format search results into a clean summary with file list.
	 *
	 * Input format:
	 * ```
	 * Found 112 results.
	 *
	 * # src/acp/__tests__/agent.test.ts
	 *   9 |
	 *  10 | // Mock the auth module
	 * ...
	 *
	 * # README.md
	 * 105 |
	 * ...
	 * ```
	 *
	 * Output format:
	 * ```
	 * Found 112 results in 20 files:
	 * • src/acp/__tests__/agent.test.ts
	 * • README.md
	 * ...
	 * ```
	 */
	private formatSearchResults(content: string): string {
		// Extract count from "Found X results" line
		const countMatch = content.match(/Found (\d+) results?/)
		const resultCount = countMatch?.[1] ? parseInt(countMatch[1], 10) : null

		// Extract unique file paths from "# path/to/file" lines
		const filePattern = /^# (.+)$/gm
		const files = new Set<string>()
		let match
		while ((match = filePattern.exec(content)) !== null) {
			if (match[1]) {
				files.add(match[1])
			}
		}

		// Sort files alphabetically
		const fileList = Array.from(files).sort((a, b) => a.localeCompare(b))

		// Build the formatted output
		if (fileList.length === 0) {
			// No files found, return original (might be "No results found" or similar)
			return content.split("\n")[0] || content
		}

		const summary =
			resultCount !== null
				? `Found ${resultCount} result${resultCount !== 1 ? "s" : ""} in ${fileList.length} file${fileList.length !== 1 ? "s" : ""}`
				: `Found matches in ${fileList.length} file${fileList.length !== 1 ? "s" : ""}`

		// Use markdown list format (renders nicely in code blocks)
		const formattedFiles = fileList.map((f) => `- ${f}`).join("\n")

		return `${summary}\n\n${formattedFiles}`
	}

	/**
	 * Handle task completion.
	 */
	private handleTaskCompleted(event: TaskCompletedEvent): void {
		acpLog.info("Session", `Task completed: success=${event.success}`)

		// Flush any buffered updates before completing
		void this.updateBuffer.flush().then(() => {
			// Resolve the pending prompt
			if (this.promptResolve) {
				// StopReason only has: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"
				// Use "refusal" for failed tasks as it's the closest match
				const stopReason: acp.StopReason = event.success ? "end_turn" : "refusal"
				acpLog.debug("Session", `Resolving prompt with stopReason: ${stopReason}`)
				this.promptResolve({ stopReason })
				this.promptResolve = null
			}

			this.isProcessingPrompt = false
			this.pendingPrompt = null
		})
	}

	// ===========================================================================
	// ACP Methods
	// ===========================================================================

	/**
	 * Process a prompt request from the ACP client.
	 */
	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		acpLog.info("Session", `Processing prompt for session ${this.sessionId}`)

		// Cancel any pending prompt
		this.cancel()

		// Reset delta tracking and buffer for new prompt
		this.resetForNewPrompt()

		this.pendingPrompt = new AbortController()
		this.isProcessingPrompt = true

		// Extract text and images from prompt
		const text = extractPromptText(params.prompt)
		const images = extractPromptImages(params.prompt)

		// Store prompt text to filter out user echo
		this.currentPromptText = text

		acpLog.debug("Session", `Prompt text (${text.length} chars), images: ${images.length}`)

		// Start the task
		if (images.length > 0) {
			acpLog.debug("Session", "Starting task with images")
			this.extensionHost.sendToExtension({
				type: "newTask",
				text,
				images,
			})
		} else {
			acpLog.debug("Session", "Starting task (text only)")
			this.extensionHost.sendToExtension({
				type: "newTask",
				text,
			})
		}

		// Wait for completion
		return new Promise((resolve) => {
			this.promptResolve = resolve

			// Handle abort
			this.pendingPrompt?.signal.addEventListener("abort", () => {
				acpLog.info("Session", "Prompt aborted")
				resolve({ stopReason: "cancelled" })
				this.promptResolve = null
			})
		})
	}

	/**
	 * Cancel the current prompt.
	 */
	cancel(): void {
		if (this.pendingPrompt) {
			acpLog.info("Session", "Cancelling pending prompt")
			this.pendingPrompt.abort()
			this.pendingPrompt = null
		}

		if (this.isProcessingPrompt) {
			acpLog.info("Session", "Sending cancelTask to extension")
			this.extensionHost.sendToExtension({ type: "cancelTask" })
			this.isProcessingPrompt = false
		}
	}

	/**
	 * Set the session mode.
	 */
	setMode(mode: string): void {
		acpLog.info("Session", `Setting mode to: ${mode}`)
		this.extensionHost.sendToExtension({
			type: "updateSettings",
			updatedSettings: { mode },
		})
	}

	/**
	 * Dispose of the session and release resources.
	 */
	async dispose(): Promise<void> {
		acpLog.info("Session", `Disposing session ${this.sessionId}`)
		this.cancel()
		// Flush any remaining buffered updates
		await this.updateBuffer.flush()
		await this.extensionHost.dispose()
		acpLog.info("Session", `Session ${this.sessionId} disposed`)
	}

	// ===========================================================================
	// Helpers
	// ===========================================================================

	/**
	 * Send an update to the ACP client through the buffer.
	 * Text chunks are batched, other updates are sent immediately.
	 */
	private async sendUpdate(update: acp.SessionNotification["update"]): Promise<void> {
		await this.updateBuffer.queueUpdate(update)
	}

	/**
	 * Send an update directly to the ACP client (bypasses buffer).
	 * Used by the UpdateBuffer to actually send batched updates.
	 */
	private async sendUpdateDirect(update: acp.SessionNotification["update"]): Promise<void> {
		try {
			await this.connection.sessionUpdate({
				sessionId: this.sessionId,
				update,
			})
		} catch (error) {
			console.error("[AcpSession] Failed to send update:", error)
		}
	}

	/**
	 * Get the session ID.
	 */
	getSessionId(): string {
		return this.sessionId
	}

	/**
	 * Check if a text message is an echo of the user's prompt.
	 *
	 * When the extension starts processing a task, it often sends a `text`
	 * message containing the user's input. Since the ACP client already
	 * displays the user's message, we should filter this out to avoid
	 * showing the message twice.
	 *
	 * Uses a fuzzy match to handle minor differences (whitespace, etc.).
	 */
	private isUserEcho(text: string): boolean {
		if (!this.currentPromptText) {
			return false
		}

		// Normalize both strings for comparison
		const normalizedPrompt = this.currentPromptText.trim().toLowerCase()
		const normalizedText = text.trim().toLowerCase()

		// Exact match
		if (normalizedText === normalizedPrompt) {
			return true
		}

		// Check if text is contained in prompt (might be truncated)
		if (normalizedPrompt.includes(normalizedText) && normalizedText.length > 10) {
			return true
		}

		// Check if prompt is contained in text (might have wrapper)
		if (normalizedText.includes(normalizedPrompt) && normalizedPrompt.length > 10) {
			return true
		}

		return false
	}
}
