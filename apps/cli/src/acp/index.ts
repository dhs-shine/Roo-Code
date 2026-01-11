/**
 * ACP (Agent Client Protocol) Integration Module
 *
 * This module provides ACP support for the Roo Code CLI, allowing ACP-compatible
 * clients like Zed to use Roo Code as their AI coding assistant.
 *
 * Main components:
 * - RooCodeAgent: Implements the acp.Agent interface
 * - AcpSession: Wraps ExtensionHost for individual sessions
 * - Translator: Converts between internal and ACP message formats
 * - UpdateBuffer: Batches session updates to reduce message frequency
 * - acpLog: File-based logger for debugging (writes to ~/.roo/acp.log)
 *
 * Note: Commands are executed internally by the extension (like the reference
 * implementations gemini-cli and opencode), not through ACP terminals.
 */

export { RooCodeAgent, type RooCodeAgentOptions } from "./agent.js"
export { AcpSession, type AcpSessionOptions } from "./session.js"
export { UpdateBuffer, type UpdateBufferOptions } from "./update-buffer.js"
export { acpLog } from "./logger.js"
export * from "./translator.js"
