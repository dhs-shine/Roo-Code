/**
 * RooCodeAgent
 *
 * Implements the ACP Agent interface to expose Roo Code as an ACP-compatible agent.
 * This allows ACP clients like Zed to use Roo Code as their AI coding assistant.
 */

import * as acp from "@agentclientprotocol/sdk"
import { randomUUID } from "node:crypto"

import { login, status } from "@/commands/auth/index.js"
import { DEFAULT_FLAGS } from "@/types/constants.js"

import { AcpSession, type AcpSessionOptions } from "./session.js"
import { acpLog } from "./logger.js"

// =============================================================================
// Types
// =============================================================================

export interface RooCodeAgentOptions {
	/** Path to the extension bundle */
	extensionPath: string
	/** API provider (defaults to openrouter) */
	provider?: string
	/** API key (optional, may come from environment) */
	apiKey?: string
	/** Model to use (defaults to a sensible default) */
	model?: string
	/** Initial mode (defaults to code) */
	mode?: string
}

// =============================================================================
// Auth Method IDs
// =============================================================================

const AUTH_METHODS = {
	ROO_CLOUD: "roo-cloud",
	API_KEY: "api-key",
} as const

// =============================================================================
// Available Modes
// =============================================================================

const AVAILABLE_MODES: acp.SessionMode[] = [
	{
		id: "code",
		name: "Code",
		description: "Write, modify, and refactor code",
	},
	{
		id: "architect",
		name: "Architect",
		description: "Plan and design system architecture",
	},
	{
		id: "ask",
		name: "Ask",
		description: "Ask questions and get explanations",
	},
	{
		id: "debug",
		name: "Debug",
		description: "Debug issues and troubleshoot problems",
	},
]

// =============================================================================
// RooCodeAgent Class
// =============================================================================

/**
 * RooCodeAgent implements the ACP Agent interface.
 *
 * It manages multiple sessions, each with its own ExtensionHost instance,
 * and handles protocol-level operations like initialization and authentication.
 */
export class RooCodeAgent implements acp.Agent {
	private sessions: Map<string, AcpSession> = new Map()
	private clientCapabilities: acp.ClientCapabilities | undefined
	private isAuthenticated = false

	constructor(
		private readonly options: RooCodeAgentOptions,
		private readonly connection: acp.AgentSideConnection,
	) {}

	// ===========================================================================
	// Initialization
	// ===========================================================================

	/**
	 * Initialize the agent and exchange capabilities with the client.
	 */
	async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
		acpLog.request("initialize", { protocolVersion: params.protocolVersion })

		this.clientCapabilities = params.clientCapabilities
		acpLog.debug("Agent", "Client capabilities", this.clientCapabilities)

		// Check if already authenticated via environment or existing credentials
		const authStatus = await status({ verbose: false })
		this.isAuthenticated = authStatus.authenticated
		acpLog.debug("Agent", `Auth status: ${this.isAuthenticated ? "authenticated" : "not authenticated"}`)

		const response: acp.InitializeResponse = {
			protocolVersion: acp.PROTOCOL_VERSION,
			authMethods: [
				{
					id: AUTH_METHODS.ROO_CLOUD,
					name: "Sign in with Roo Code Cloud",
					description: "Sign in with your Roo Code Cloud account for access to all features",
				},
				{
					id: AUTH_METHODS.API_KEY,
					name: "Use API Key",
					description: "Use an API key directly (set OPENROUTER_API_KEY or similar environment variable)",
				},
			],
			agentCapabilities: {
				loadSession: false,
				promptCapabilities: {
					image: true,
					embeddedContext: true,
				},
			},
		}

		acpLog.response("initialize", response)
		return response
	}

	// ===========================================================================
	// Authentication
	// ===========================================================================

	/**
	 * Authenticate with the specified method.
	 */
	async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
		acpLog.request("authenticate", { methodId: params.methodId })

		switch (params.methodId) {
			case AUTH_METHODS.ROO_CLOUD: {
				acpLog.info("Agent", "Starting Roo Code Cloud login flow")
				// Trigger Roo Code Cloud login flow
				const result = await login({ verbose: false })
				if (!result.success) {
					acpLog.error("Agent", "Roo Code Cloud login failed")
					throw acp.RequestError.authRequired(undefined, "Failed to authenticate with Roo Code Cloud")
				}
				this.isAuthenticated = true
				acpLog.info("Agent", "Roo Code Cloud login successful")
				break
			}

			case AUTH_METHODS.API_KEY: {
				// API key authentication - verify key exists
				const apiKey = this.options.apiKey || process.env.OPENROUTER_API_KEY
				if (!apiKey) {
					acpLog.error("Agent", "No API key found")
					throw acp.RequestError.authRequired(
						undefined,
						"No API key found. Set OPENROUTER_API_KEY environment variable.",
					)
				}
				this.isAuthenticated = true
				acpLog.info("Agent", "API key authentication successful")
				break
			}

			default:
				acpLog.error("Agent", `Unknown auth method: ${params.methodId}`)
				throw acp.RequestError.invalidParams(undefined, `Unknown auth method: ${params.methodId}`)
		}

		acpLog.response("authenticate", {})
		return {}
	}

	// ===========================================================================
	// Session Management
	// ===========================================================================

	/**
	 * Create a new session.
	 */
	async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		acpLog.request("newSession", { cwd: params.cwd })

		// Require authentication
		if (!this.isAuthenticated) {
			// Check if API key is available
			const apiKey = this.options.apiKey || process.env.OPENROUTER_API_KEY
			if (!apiKey) {
				acpLog.error("Agent", "newSession failed: not authenticated and no API key")
				throw acp.RequestError.authRequired()
			}
			this.isAuthenticated = true
		}

		const sessionId = randomUUID()
		acpLog.info("Agent", `Creating new session: ${sessionId}`)

		const sessionOptions: AcpSessionOptions = {
			extensionPath: this.options.extensionPath,
			provider: this.options.provider || "openrouter",
			apiKey: this.options.apiKey || process.env.OPENROUTER_API_KEY,
			model: this.options.model || DEFAULT_FLAGS.model,
			mode: this.options.mode || "code",
		}

		acpLog.debug("Agent", "Session options", {
			extensionPath: sessionOptions.extensionPath,
			provider: sessionOptions.provider,
			model: sessionOptions.model,
			mode: sessionOptions.mode,
		})

		const session = await AcpSession.create(
			sessionId,
			params.cwd,
			this.connection,
			this.clientCapabilities,
			sessionOptions,
		)

		this.sessions.set(sessionId, session)
		acpLog.info("Agent", `Session created successfully: ${sessionId}`)

		const response = { sessionId }
		acpLog.response("newSession", response)
		return response
	}

	// ===========================================================================
	// Prompt Handling
	// ===========================================================================

	/**
	 * Process a prompt request.
	 */
	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		acpLog.request("prompt", {
			sessionId: params.sessionId,
			promptLength: params.prompt?.length ?? 0,
		})

		const session = this.sessions.get(params.sessionId)
		if (!session) {
			acpLog.error("Agent", `prompt failed: session not found: ${params.sessionId}`)
			throw acp.RequestError.invalidParams(undefined, `Session not found: ${params.sessionId}`)
		}

		const response = await session.prompt(params)
		acpLog.response("prompt", response)
		return response
	}

	// ===========================================================================
	// Session Control
	// ===========================================================================

	/**
	 * Cancel an ongoing prompt.
	 */
	async cancel(params: acp.CancelNotification): Promise<void> {
		acpLog.request("cancel", { sessionId: params.sessionId })

		const session = this.sessions.get(params.sessionId)
		if (session) {
			session.cancel()
			acpLog.info("Agent", `Cancelled session: ${params.sessionId}`)
		} else {
			acpLog.warn("Agent", `cancel: session not found: ${params.sessionId}`)
		}
	}

	/**
	 * Set the session mode.
	 */
	async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse | void> {
		acpLog.request("setSessionMode", { sessionId: params.sessionId, modeId: params.modeId })

		const session = this.sessions.get(params.sessionId)
		if (!session) {
			acpLog.error("Agent", `setSessionMode failed: session not found: ${params.sessionId}`)
			throw acp.RequestError.invalidParams(undefined, `Session not found: ${params.sessionId}`)
		}

		const mode = AVAILABLE_MODES.find((m) => m.id === params.modeId)
		if (!mode) {
			acpLog.error("Agent", `setSessionMode failed: unknown mode: ${params.modeId}`)
			throw acp.RequestError.invalidParams(undefined, `Unknown mode: ${params.modeId}`)
		}

		session.setMode(params.modeId)
		acpLog.info("Agent", `Set session ${params.sessionId} mode to: ${params.modeId}`)
		acpLog.response("setSessionMode", {})
		return {}
	}

	// ===========================================================================
	// Cleanup
	// ===========================================================================

	/**
	 * Dispose of all sessions and cleanup.
	 */
	async dispose(): Promise<void> {
		acpLog.info("Agent", `Disposing ${this.sessions.size} sessions`)
		const disposals = Array.from(this.sessions.values()).map((session) => session.dispose())
		await Promise.all(disposals)
		this.sessions.clear()
		acpLog.info("Agent", "All sessions disposed")
	}
}
