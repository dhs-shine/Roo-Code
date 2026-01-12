/**
 * ACP Session
 *
 * Manages a single ACP session, wrapping an ExtensionHost instance.
 * Handles message translation, event streaming, and permission requests.
 */

import {
	type SessionNotification,
	type ClientCapabilities,
	type PromptRequest,
	type PromptResponse,
	type SessionModeState,
	AgentSideConnection,
} from "@agentclientprotocol/sdk"

import { type ExtensionHostOptions, ExtensionHost } from "@/agent/extension-host.js"

import { DEFAULT_MODELS } from "./types.js"
import { extractPromptText, extractPromptImages } from "./translator.js"
import { acpLog } from "./logger.js"
import { DeltaTracker } from "./delta-tracker.js"
import { UpdateBuffer } from "./update-buffer.js"
import { PromptStateMachine } from "./prompt-state.js"
import { ToolHandlerRegistry } from "./tool-handler.js"
import { CommandStreamManager } from "./command-stream.js"
import { ToolContentStreamManager } from "./tool-content-stream.js"
import { SessionEventHandler, createSessionEventHandler } from "./session-event-handler.js"
import type {
	IAcpSession,
	IAcpLogger,
	IDeltaTracker,
	IUpdateBuffer,
	IPromptStateMachine,
	AcpSessionDependencies,
} from "./interfaces.js"
import { type Result, ok, err } from "./utils/index.js"

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

/**
 * AcpSession wraps an ExtensionHost instance and bridges it to the ACP protocol.
 *
 * Each ACP session creates its own ExtensionHost, which loads the extension
 * in a sandboxed environment. The session translates events from the
 * ExtensionClient to ACP session updates and handles permission requests.
 */
export class AcpSession implements IAcpSession {
	/** Logger instance (injected) */
	private readonly logger: IAcpLogger

	/** State machine for prompt lifecycle management */
	private readonly promptState: IPromptStateMachine

	/** Delta tracker for streaming content - ensures only new text is sent */
	private readonly deltaTracker: IDeltaTracker

	/** Update buffer for batching session updates to reduce message frequency */
	private readonly updateBuffer: IUpdateBuffer

	/** Tool handler registry for polymorphic tool dispatch */
	private readonly toolHandlerRegistry: ToolHandlerRegistry

	/** Command stream manager for handling command output */
	private readonly commandStreamManager: CommandStreamManager

	/** Tool content stream manager for handling file creates/edits */
	private readonly toolContentStreamManager: ToolContentStreamManager

	/** Session event handler for managing extension events */
	private readonly eventHandler: SessionEventHandler

	/** Workspace path for resolving relative file paths */
	private readonly workspacePath: string

	/** Current model ID */
	private currentModelId: string = DEFAULT_MODELS[0]!.modelId

	private constructor(
		private readonly sessionId: string,
		private readonly extensionHost: ExtensionHost,
		private readonly connection: AgentSideConnection,
		workspacePath: string,
		initialMode: string,
		deps: AcpSessionDependencies = {},
	) {
		this.workspacePath = workspacePath

		// Initialize dependencies with defaults or injected instances.
		this.logger = deps.logger ?? acpLog
		this.promptState = deps.createPromptStateMachine?.() ?? new PromptStateMachine({ logger: this.logger })
		this.deltaTracker = deps.createDeltaTracker?.() ?? new DeltaTracker()

		// Initialize update buffer with the actual send function.
		// Uses defaults: 200 chars min buffer, 500ms delay.
		// Wrap sendUpdateDirect to match the expected Promise<void> signature.
		const sendDirectAdapter = async (update: SessionNotification["update"]): Promise<void> => {
			await this.sendUpdateDirect(update)
			// Result is logged internally; adapter converts to void for interface compatibility.
		}

		this.updateBuffer =
			deps.createUpdateBuffer?.(sendDirectAdapter) ?? new UpdateBuffer(sendDirectAdapter, { logger: this.logger })

		// Initialize tool handler registry.
		this.toolHandlerRegistry = new ToolHandlerRegistry()

		// Create send update callback for stream managers.
		const sendUpdate = (update: SessionNotification["update"]) => {
			void this.sendUpdate(update)
		}

		// Initialize stream managers with injected logger.
		this.commandStreamManager = new CommandStreamManager({
			deltaTracker: this.deltaTracker,
			sendUpdate,
			logger: this.logger,
		})

		this.toolContentStreamManager = new ToolContentStreamManager({
			deltaTracker: this.deltaTracker,
			sendUpdate,
			logger: this.logger,
		})

		// Create event handler with extension host for mode tracking
		this.eventHandler = createSessionEventHandler({
			logger: this.logger,
			client: extensionHost.client,
			extensionHost,
			promptState: this.promptState,
			deltaTracker: this.deltaTracker,
			commandStreamManager: this.commandStreamManager,
			toolContentStreamManager: this.toolContentStreamManager,
			toolHandlerRegistry: this.toolHandlerRegistry,
			sendUpdate,
			approveAction: () => this.extensionHost.client.approve(),
			respondWithText: (text: string) => this.extensionHost.client.respond(text),
			sendToExtension: (message) =>
				this.extensionHost.sendToExtension(message as Parameters<typeof this.extensionHost.sendToExtension>[0]),
			workspacePath,
			initialModeId: initialMode,
		})

		this.eventHandler.onTaskCompleted((success) => this.handleTaskCompleted(success))
	}

	// ===========================================================================
	// Factory Method
	// ===========================================================================

	/**
	 * Create a new AcpSession.
	 *
	 * This initializes an ExtensionHost for the given working directory
	 * and sets up event handlers to stream updates to the ACP client.
	 *
	 * @param sessionId - Unique session identifier
	 * @param cwd - Working directory for the session
	 * @param connection - ACP connection for sending updates
	 * @param _clientCapabilities - Client capabilities (currently unused)
	 * @param options - Session configuration options
	 * @param deps - Optional dependencies for testing
	 */
	static async create(
		sessionId: string,
		cwd: string,
		connection: AgentSideConnection,
		_clientCapabilities: ClientCapabilities | undefined,
		options: AcpSessionOptions,
		deps: AcpSessionDependencies = {},
	): Promise<AcpSession> {
		const logger = deps.logger ?? acpLog
		logger.info("Session", `Creating session ${sessionId} in ${cwd}`)

		// Create ExtensionHost with ACP-specific configuration.
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

		logger.debug("Session", "Creating ExtensionHost", hostOptions)
		const extensionHost = new ExtensionHost(hostOptions)
		await extensionHost.activate()
		logger.info("Session", `ExtensionHost activated for session ${sessionId}`)

		const session = new AcpSession(sessionId, extensionHost, connection, cwd, options.mode, deps)
		session.setupEventHandlers()

		return session
	}

	// ===========================================================================
	// Event Handlers
	// ===========================================================================

	/**
	 * Set up event handlers to translate ExtensionClient events to ACP updates.
	 * This includes both ExtensionClient events and ExtensionHost events (modes, state).
	 */
	private setupEventHandlers(): void {
		this.eventHandler.setupEventHandlers()
	}

	/**
	 * Reset state for a new prompt.
	 */
	private resetForNewPrompt(): void {
		this.eventHandler.reset()
		this.updateBuffer.reset()
	}

	/**
	 * Handle task completion.
	 */
	private handleTaskCompleted(success: boolean): void {
		// Flush any buffered updates before completing.
		void this.updateBuffer.flush().then(() => {
			// Complete the prompt using the state machine.
			const stopReason = this.promptState.complete(success)
			this.logger.debug("Session", `Resolving prompt with stopReason: ${stopReason}`)
		})
	}

	// ===========================================================================
	// ACP Methods
	// ===========================================================================

	/**
	 * Process a prompt request from the ACP client.
	 */
	async prompt(params: PromptRequest): Promise<PromptResponse> {
		this.logger.info("Session", `Processing prompt for session ${this.sessionId}`)

		// Cancel any pending prompt.
		this.cancel()

		// Reset state for new prompt.
		this.resetForNewPrompt()

		// Extract text and images from prompt.
		const text = extractPromptText(params.prompt)
		const images = extractPromptImages(params.prompt)

		this.logger.debug("Session", `Prompt text (${text.length} chars), images: ${images.length}`)

		// Start the prompt using the state machine.
		const promise = this.promptState.startPrompt(text)

		if (images.length > 0) {
			this.logger.debug("Session", "Starting task with images")
			this.extensionHost.sendToExtension({ type: "newTask", text, images })
		} else {
			this.logger.debug("Session", "Starting task (text only)")
			this.extensionHost.sendToExtension({ type: "newTask", text })
		}

		return promise
	}

	/**
	 * Cancel the current prompt.
	 */
	cancel(): void {
		if (this.promptState.isProcessing()) {
			this.logger.info("Session", "Cancelling pending prompt")
			this.promptState.cancel()
			this.logger.info("Session", "Sending cancelTask to extension")
			this.extensionHost.sendToExtension({ type: "cancelTask" })
		}
	}

	/**
	 * Set the session mode (Roo Code operational mode like 'code', 'architect').
	 * The mode change is tracked by the event handler which listens to extension state updates.
	 */
	setMode(mode: string): void {
		this.logger.info("Session", `Setting mode to: ${mode}`)
		this.extensionHost.sendToExtension({ type: "updateSettings", updatedSettings: { mode } })
	}

	/**
	 * Set the current model.
	 * This updates the provider settings to use the specified model.
	 */
	setModel(modelId: string): void {
		this.logger.info("Session", `Setting model to: ${modelId}`)
		this.currentModelId = modelId

		// Map model ID to extension settings
		// The property is apiModelId for most providers
		this.extensionHost.sendToExtension({
			type: "updateSettings",
			updatedSettings: { apiModelId: modelId },
		})
	}

	/**
	 * Get the current mode state (delegated to event handler).
	 */
	getModeState(): SessionModeState {
		return {
			currentModeId: this.eventHandler.getCurrentModeId(),
			availableModes: this.eventHandler.getAvailableModes(),
		}
	}

	/**
	 * Get the current mode ID (delegated to event handler).
	 */
	getCurrentModeId(): string {
		return this.eventHandler.getCurrentModeId()
	}

	/**
	 * Get the current model ID.
	 */
	getCurrentModelId(): string {
		return this.currentModelId
	}

	/**
	 * Dispose of the session and release resources.
	 */
	async dispose(): Promise<void> {
		this.logger.info("Session", `Disposing session ${this.sessionId}`)
		this.cancel()

		// Clean up event handler listeners
		this.eventHandler.cleanup()

		// Flush any remaining buffered updates.
		await this.updateBuffer.flush()
		await this.extensionHost.dispose()
		this.logger.info("Session", `Session ${this.sessionId} disposed`)
	}

	// ===========================================================================
	// Helpers
	// ===========================================================================

	/**
	 * Send an update to the ACP client through the buffer.
	 * Text chunks are batched, other updates are sent immediately.
	 *
	 * @returns Result indicating success or failure.
	 */
	private async sendUpdate(update: SessionNotification["update"]): Promise<Result<void>> {
		try {
			await this.updateBuffer.queueUpdate(update)
			return ok(undefined)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.logger.error("Session", `Failed to queue update: ${errorMessage}`)
			return err(`Failed to queue update: ${errorMessage}`)
		}
	}

	/**
	 * Send an update directly to the ACP client (bypasses buffer).
	 * Used by the UpdateBuffer to actually send batched updates.
	 *
	 * @returns Result indicating success or failure with error details.
	 */
	private async sendUpdateDirect(update: SessionNotification["update"]): Promise<Result<void>> {
		try {
			// Log the full update being sent to ACP connection
			this.logger.debug("Session", `ACP OUT: ${JSON.stringify({ sessionId: this.sessionId, update })}`)
			await this.connection.sessionUpdate({ sessionId: this.sessionId, update })
			return ok(undefined)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.logger.error("Session", `Failed to send update: ${errorMessage}`, error)
			return err(`Failed to send update to ACP client: ${errorMessage}`)
		}
	}

	/**
	 * Get the session ID.
	 */
	getSessionId(): string {
		return this.sessionId
	}
}
