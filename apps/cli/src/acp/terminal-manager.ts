/**
 * ACP Terminal Manager
 *
 * Manages ACP terminals for command execution. When the client supports terminals,
 * this manager handles creating, tracking, and releasing terminals according to
 * the ACP protocol specification.
 */

import * as acp from "@agentclientprotocol/sdk"

import { acpLog } from "./logger.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Information about an active terminal.
 */
export interface ActiveTerminal {
	/** The terminal handle from ACP SDK */
	handle: acp.TerminalHandle
	/** The command being executed */
	command: string
	/** Working directory for the command */
	cwd?: string
	/** Timestamp when the terminal was created */
	createdAt: number
	/** Associated tool call ID (for embedding in tool calls) */
	toolCallId?: string
}

/**
 * Parsed command information extracted from a Roo Code command message.
 */
export interface ParsedCommand {
	/** The full command string (may include shell operators) */
	fullCommand: string
	/** The executable/command name */
	executable: string
	/** Command arguments */
	args: string[]
	/** Working directory (if specified) */
	cwd?: string
}

// =============================================================================
// Terminal Manager
// =============================================================================

/**
 * Manages ACP terminals for command execution.
 *
 * This class handles the lifecycle of ACP terminals:
 * 1. Creating terminals via terminal/create
 * 2. Tracking active terminals
 * 3. Releasing terminals when done
 *
 * According to the ACP spec, terminals should be:
 * - Created with terminal/create
 * - Embedded in tool calls using { type: "terminal", terminalId }
 * - Released with terminal/release when done
 */
export class TerminalManager {
	/** Map of terminal IDs to active terminal info */
	private terminals: Map<string, ActiveTerminal> = new Map()

	constructor(
		private readonly sessionId: string,
		private readonly connection: acp.AgentSideConnection,
	) {}

	// ===========================================================================
	// Terminal Lifecycle
	// ===========================================================================

	/**
	 * Create a new terminal and execute a command.
	 *
	 * @param command - The command to execute
	 * @param cwd - Working directory for the command
	 * @param toolCallId - Optional tool call ID for embedding
	 * @returns The terminal handle and ID
	 */
	async createTerminal(
		command: string,
		cwd: string,
		toolCallId?: string,
	): Promise<{ handle: acp.TerminalHandle; terminalId: string }> {
		acpLog.debug("TerminalManager", `Creating terminal for command: ${command}`)

		const parsed = this.parseCommand(command)

		try {
			const handle = await this.connection.createTerminal({
				sessionId: this.sessionId,
				command: parsed.executable,
				args: parsed.args,
				cwd: parsed.cwd || cwd,
			})

			const terminalId = handle.id
			acpLog.info("TerminalManager", `Terminal created: ${terminalId}`)

			// Track the terminal
			this.terminals.set(terminalId, {
				handle,
				command,
				cwd: parsed.cwd || cwd,
				createdAt: Date.now(),
				toolCallId,
			})

			return { handle, terminalId }
		} catch (error) {
			acpLog.error("TerminalManager", `Failed to create terminal: ${error}`)
			throw error
		}
	}

	/**
	 * Get terminal output without waiting for exit.
	 */
	async getOutput(terminalId: string): Promise<acp.TerminalOutputResponse | null> {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			acpLog.warn("TerminalManager", `Terminal not found: ${terminalId}`)
			return null
		}

		try {
			return await terminal.handle.currentOutput()
		} catch (error) {
			acpLog.error("TerminalManager", `Failed to get output for ${terminalId}: ${error}`)
			return null
		}
	}

	/**
	 * Wait for a terminal to exit and return the result.
	 */
	async waitForExit(
		terminalId: string,
	): Promise<{ exitCode: number | null; signal: string | null; output: string } | null> {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			acpLog.warn("TerminalManager", `Terminal not found: ${terminalId}`)
			return null
		}

		try {
			acpLog.debug("TerminalManager", `Waiting for exit: ${terminalId}`)

			// Wait for the command to complete
			const exitStatus = await terminal.handle.waitForExit()

			// Get the final output
			const outputResponse = await terminal.handle.currentOutput()

			acpLog.info("TerminalManager", `Terminal ${terminalId} exited: code=${exitStatus.exitCode}`)

			return {
				exitCode: exitStatus.exitCode ?? null,
				signal: exitStatus.signal ?? null,
				output: outputResponse.output,
			}
		} catch (error) {
			acpLog.error("TerminalManager", `Failed to wait for ${terminalId}: ${error}`)
			return null
		}
	}

	/**
	 * Kill a running terminal command.
	 */
	async killTerminal(terminalId: string): Promise<boolean> {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			acpLog.warn("TerminalManager", `Terminal not found: ${terminalId}`)
			return false
		}

		try {
			await terminal.handle.kill()
			acpLog.info("TerminalManager", `Terminal killed: ${terminalId}`)
			return true
		} catch (error) {
			acpLog.error("TerminalManager", `Failed to kill ${terminalId}: ${error}`)
			return false
		}
	}

	/**
	 * Release a terminal and free its resources.
	 * This MUST be called when done with a terminal.
	 */
	async releaseTerminal(terminalId: string): Promise<boolean> {
		const terminal = this.terminals.get(terminalId)
		if (!terminal) {
			acpLog.warn("TerminalManager", `Terminal not found: ${terminalId}`)
			return false
		}

		try {
			await terminal.handle.release()
			this.terminals.delete(terminalId)
			acpLog.info("TerminalManager", `Terminal released: ${terminalId}`)
			return true
		} catch (error) {
			acpLog.error("TerminalManager", `Failed to release ${terminalId}: ${error}`)
			// Still remove from tracking even if release failed
			this.terminals.delete(terminalId)
			return false
		}
	}

	/**
	 * Release all active terminals.
	 */
	async releaseAll(): Promise<void> {
		acpLog.info("TerminalManager", `Releasing ${this.terminals.size} terminals`)

		const releasePromises = Array.from(this.terminals.keys()).map((id) => this.releaseTerminal(id))

		await Promise.all(releasePromises)
	}

	// ===========================================================================
	// Query Methods
	// ===========================================================================

	/**
	 * Check if a terminal exists.
	 */
	hasTerminal(terminalId: string): boolean {
		return this.terminals.has(terminalId)
	}

	/**
	 * Get information about a terminal.
	 */
	getTerminalInfo(terminalId: string): ActiveTerminal | undefined {
		return this.terminals.get(terminalId)
	}

	/**
	 * Get all active terminal IDs.
	 */
	getActiveTerminalIds(): string[] {
		return Array.from(this.terminals.keys())
	}

	/**
	 * Get the count of active terminals.
	 */
	get activeCount(): number {
		return this.terminals.size
	}

	// ===========================================================================
	// Helpers
	// ===========================================================================

	/**
	 * Parse a command string into executable and arguments.
	 *
	 * This handles common shell command patterns and extracts:
	 * - The executable (first word or path)
	 * - Arguments
	 * - Working directory changes (cd ... &&)
	 */
	parseCommand(command: string): ParsedCommand {
		// Trim and normalize whitespace
		const trimmed = command.trim()

		// Check for cd command at the start (common pattern: cd /path && command)
		const cdMatch = trimmed.match(/^cd\s+([^\s&]+)\s*&&\s*(.+)$/i)
		if (cdMatch && cdMatch[1] && cdMatch[2]) {
			const cwd = cdMatch[1]
			const restCommand = cdMatch[2]
			const parsed = this.parseSimpleCommand(restCommand)
			return {
				...parsed,
				cwd,
			}
		}

		return this.parseSimpleCommand(trimmed)
	}

	/**
	 * Parse a simple command (no cd prefix) into parts.
	 */
	private parseSimpleCommand(command: string): ParsedCommand {
		// For shell commands with operators, we need to run through a shell
		// Check for shell operators
		const hasShellOperators = /[|&;<>]/.test(command)

		if (hasShellOperators) {
			// Run through shell to handle operators
			const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh"
			const shellArg = process.platform === "win32" ? "/c" : "-c"

			return {
				fullCommand: command,
				executable: shell,
				args: [shellArg, command],
			}
		}

		// Simple command - split on whitespace
		const parts = command.split(/\s+/).filter(Boolean)
		const executable = parts[0] || command
		const args = parts.slice(1)

		return {
			fullCommand: command,
			executable,
			args,
		}
	}
}
