/**
 * ACP File System Service
 *
 * Delegates file system operations to the ACP client when supported.
 * Falls back to direct file system operations when the client doesn't
 * support the required capabilities.
 */

import * as acp from "@agentclientprotocol/sdk"
import * as fs from "node:fs/promises"
import * as path from "node:path"

// =============================================================================
// AcpFileSystemService Class
// =============================================================================

/**
 * AcpFileSystemService provides file system operations that can be delegated
 * to the ACP client or performed locally.
 *
 * This allows the ACP client (like Zed) to handle file operations within
 * its own context, providing proper integration with the editor's file system,
 * undo stack, and other features.
 */
export class AcpFileSystemService {
	constructor(
		private readonly connection: acp.AgentSideConnection,
		private readonly sessionId: string,
		private readonly capabilities: acp.FileSystemCapability | undefined,
		private readonly workspacePath: string,
	) {}

	// ===========================================================================
	// Read Operations
	// ===========================================================================

	/**
	 * Read text content from a file.
	 *
	 * If the ACP client supports readTextFile, delegates to the client.
	 * Otherwise, reads directly from the file system.
	 */
	async readTextFile(filePath: string): Promise<string> {
		// Resolve path relative to workspace
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.workspacePath, filePath)

		// Use client capability if available
		if (this.capabilities?.readTextFile) {
			try {
				const response = await this.connection.readTextFile({
					path: absolutePath,
					sessionId: this.sessionId,
				})
				return response.content
			} catch (error) {
				// Fall back to direct read on error
				console.warn("[AcpFileSystemService] Client read failed, falling back to direct read:", error)
			}
		}

		// Direct file system read
		return fs.readFile(absolutePath, "utf-8")
	}

	// ===========================================================================
	// Write Operations
	// ===========================================================================

	/**
	 * Write text content to a file.
	 *
	 * If the ACP client supports writeTextFile, delegates to the client.
	 * Otherwise, writes directly to the file system.
	 */
	async writeTextFile(filePath: string, content: string): Promise<void> {
		// Resolve path relative to workspace
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.workspacePath, filePath)

		// Use client capability if available
		if (this.capabilities?.writeTextFile) {
			try {
				await this.connection.writeTextFile({
					path: absolutePath,
					content,
					sessionId: this.sessionId,
				})
				return
			} catch (error) {
				// Fall back to direct write on error
				console.warn("[AcpFileSystemService] Client write failed, falling back to direct write:", error)
			}
		}

		// Ensure directory exists
		const dir = path.dirname(absolutePath)
		await fs.mkdir(dir, { recursive: true })

		// Direct file system write
		await fs.writeFile(absolutePath, content, "utf-8")
	}

	// ===========================================================================
	// Capability Checks
	// ===========================================================================

	/**
	 * Check if the client supports reading files.
	 */
	canReadTextFile(): boolean {
		return this.capabilities?.readTextFile === true
	}

	/**
	 * Check if the client supports writing files.
	 */
	canWriteTextFile(): boolean {
		return this.capabilities?.writeTextFile === true
	}

	/**
	 * Check if any client file system capabilities are available.
	 */
	hasClientCapabilities(): boolean {
		return this.canReadTextFile() || this.canWriteTextFile()
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AcpFileSystemService if the client has file system capabilities.
 */
export function createAcpFileSystemService(
	connection: acp.AgentSideConnection,
	sessionId: string,
	clientCapabilities: acp.ClientCapabilities | undefined,
	workspacePath: string,
): AcpFileSystemService | null {
	const fsCapabilities = clientCapabilities?.fs

	if (!fsCapabilities) {
		return null
	}

	return new AcpFileSystemService(connection, sessionId, fsCapabilities, workspacePath)
}
