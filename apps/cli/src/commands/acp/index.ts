/**
 * ACP Command
 *
 * Starts the Roo Code CLI in ACP server mode, allowing ACP-compatible clients
 * like Zed to use Roo Code as their AI coding assistant.
 *
 * Usage:
 *   roo acp [options]
 *
 * The ACP server communicates over stdin/stdout using the ACP protocol
 * (JSON-RPC over newline-delimited JSON).
 */

import { Readable, Writable } from "node:stream"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as acpSdk from "@agentclientprotocol/sdk"

import { type RooCodeAgentOptions, RooCodeAgent, acpLog } from "@/acp/index.js"
import { DEFAULT_FLAGS } from "@/types/constants.js"
import { getDefaultExtensionPath } from "@/lib/utils/extension.js"

// =============================================================================
// Types
// =============================================================================

export interface AcpCommandOptions {
	/** Path to the extension bundle directory */
	extension?: string
	/** API provider (anthropic, openai, openrouter, etc.) */
	provider?: string
	/** Model to use */
	model?: string
	/** Initial mode (code, architect, ask, debug) */
	mode?: string
	/** API key */
	apiKey?: string
}

// =============================================================================
// ACP Server
// =============================================================================

/**
 * Run the ACP server.
 *
 * This sets up the ACP connection using stdin/stdout and creates a RooCodeAgent
 * to handle incoming requests.
 */
export async function runAcpServer(options: AcpCommandOptions): Promise<void> {
	acpLog.info("Command", "Starting ACP server")
	acpLog.debug("Command", "Options", options)

	// Resolve extension path
	const __dirname = path.dirname(fileURLToPath(import.meta.url))
	const extensionPath = options.extension || getDefaultExtensionPath(__dirname)

	if (!extensionPath) {
		acpLog.error("Command", "Extension path not found")
		console.error("Error: Extension path not found. Use --extension to specify the path.")
		process.exit(1)
	}

	acpLog.info("Command", `Extension path: ${extensionPath}`)

	// Create agent options
	const agentOptions: RooCodeAgentOptions = {
		extensionPath,
		provider: options.provider || DEFAULT_FLAGS.provider,
		model: options.model || DEFAULT_FLAGS.model,
		mode: options.mode || DEFAULT_FLAGS.mode,
		apiKey: options.apiKey || process.env.OPENROUTER_API_KEY,
	}

	acpLog.debug("Command", "Agent options", {
		extensionPath: agentOptions.extensionPath,
		provider: agentOptions.provider,
		model: agentOptions.model,
		mode: agentOptions.mode,
		hasApiKey: !!agentOptions.apiKey,
	})

	// Set up stdio streams for ACP communication
	// Note: We write to stdout (agent -> client) and read from stdin (client -> agent)
	const stdout = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>
	const stdin = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>

	// Create the ACP stream
	const stream = acpSdk.ndJsonStream(stdout, stdin)
	acpLog.info("Command", "ACP stream created, waiting for connection")

	// Create the agent connection
	let agent: RooCodeAgent | null = null

	const connection = new acpSdk.AgentSideConnection((conn: acpSdk.AgentSideConnection) => {
		acpLog.info("Command", "Agent connection established")
		agent = new RooCodeAgent(agentOptions, conn)
		return agent
	}, stream)

	// Handle graceful shutdown
	const cleanup = async () => {
		acpLog.info("Command", "Received shutdown signal, cleaning up")
		if (agent) {
			await agent.dispose()
		}
		acpLog.info("Command", "Cleanup complete, exiting")
		process.exit(0)
	}

	process.on("SIGINT", cleanup)
	process.on("SIGTERM", cleanup)

	// Wait for the connection to close
	acpLog.info("Command", "Waiting for connection to close")
	await connection.closed
	acpLog.info("Command", "Connection closed")
}

// =============================================================================
// Command Action
// =============================================================================

/**
 * Action handler for the `roo acp` command.
 */
export async function acp(options: AcpCommandOptions): Promise<void> {
	try {
		await runAcpServer(options)
	} catch (error) {
		// Log errors to file and stderr so they don't interfere with ACP protocol
		acpLog.error("Command", "Fatal error", error)
		console.error("[ACP] Fatal error:", error)
		process.exit(1)
	}
}
