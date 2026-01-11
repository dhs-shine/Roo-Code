/**
 * ACP Update Buffer
 *
 * Intelligently buffers session updates to reduce message frequency.
 * Text chunks are batched based on size and time thresholds, while
 * tool calls and other updates are passed through immediately.
 */

import type * as acp from "@agentclientprotocol/sdk"
import { acpLog } from "./logger.js"

// =============================================================================
// Types (exported)
// =============================================================================

export type { UpdateBufferOptions }

interface UpdateBufferOptions {
	/** Minimum characters to buffer before flushing (default: 200) */
	minBufferSize?: number
	/** Maximum time in ms before flushing (default: 500) */
	flushDelayMs?: number
}

type TextChunkUpdate = {
	sessionUpdate: "agent_message_chunk" | "agent_thought_chunk"
	content: { type: "text"; text: string }
}

type SessionUpdate = acp.SessionNotification["update"]

// Type guard for text chunk updates
function isTextChunkUpdate(update: SessionUpdate): update is TextChunkUpdate {
	const u = update as TextChunkUpdate
	return (
		(u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "agent_thought_chunk") &&
		u.content?.type === "text"
	)
}

// =============================================================================
// UpdateBuffer Class
// =============================================================================

/**
 * Buffers session updates to reduce the number of messages sent to the client.
 *
 * Text chunks (agent_message_chunk, agent_thought_chunk) are batched together
 * and flushed when either:
 * - The buffer size reaches minBufferSize
 * - The flush delay timer expires
 * - flush() is called manually
 *
 * Tool calls and other updates are passed through immediately.
 */
export class UpdateBuffer {
	private readonly minBufferSize: number
	private readonly flushDelayMs: number

	/** Buffered text for agent_message_chunk */
	private messageBuffer = ""
	/** Buffered text for agent_thought_chunk */
	private thoughtBuffer = ""
	/** Timer for delayed flush */
	private flushTimer: ReturnType<typeof setTimeout> | null = null
	/** Callback to send updates */
	private readonly sendUpdate: (update: SessionUpdate) => Promise<void>
	/** Track if we have pending buffered content */
	private hasPendingContent = false

	constructor(sendUpdate: (update: SessionUpdate) => Promise<void>, options: UpdateBufferOptions = {}) {
		this.minBufferSize = options.minBufferSize ?? 200
		this.flushDelayMs = options.flushDelayMs ?? 500
		this.sendUpdate = sendUpdate
	}

	// ===========================================================================
	// Public API
	// ===========================================================================

	/**
	 * Queue an update for sending.
	 *
	 * Text chunks are buffered and batched. Other updates are sent immediately.
	 */
	async queueUpdate(update: SessionUpdate): Promise<void> {
		if (isTextChunkUpdate(update)) {
			this.bufferTextChunk(update)
		} else {
			// Flush any pending text before sending non-text update
			// This ensures correct ordering
			await this.flush()
			await this.sendUpdate(update)
		}
	}

	/**
	 * Flush all pending buffered content.
	 *
	 * Should be called when the session ends or when immediate delivery is needed.
	 */
	async flush(): Promise<void> {
		this.clearFlushTimer()

		if (!this.hasPendingContent) {
			return
		}

		acpLog.debug(
			"UpdateBuffer",
			`Flushing buffers: message=${this.messageBuffer.length}, thought=${this.thoughtBuffer.length}`,
		)

		// Send buffered message content
		if (this.messageBuffer.length > 0) {
			await this.sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: this.messageBuffer },
			})
			this.messageBuffer = ""
		}

		// Send buffered thought content
		if (this.thoughtBuffer.length > 0) {
			await this.sendUpdate({
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: this.thoughtBuffer },
			})
			this.thoughtBuffer = ""
		}

		this.hasPendingContent = false
	}

	/**
	 * Reset the buffer state.
	 *
	 * Should be called when starting a new prompt.
	 */
	reset(): void {
		this.clearFlushTimer()
		this.messageBuffer = ""
		this.thoughtBuffer = ""
		this.hasPendingContent = false
		acpLog.debug("UpdateBuffer", "Buffer reset")
	}

	/**
	 * Get current buffer sizes for debugging/testing.
	 */
	getBufferSizes(): { message: number; thought: number } {
		return {
			message: this.messageBuffer.length,
			thought: this.thoughtBuffer.length,
		}
	}

	// ===========================================================================
	// Private Methods
	// ===========================================================================

	/**
	 * Buffer a text chunk update.
	 */
	private bufferTextChunk(update: TextChunkUpdate): void {
		const text = update.content.text

		if (update.sessionUpdate === "agent_message_chunk") {
			this.messageBuffer += text
		} else {
			this.thoughtBuffer += text
		}

		this.hasPendingContent = true

		// Check if we should flush based on size
		const totalSize = this.messageBuffer.length + this.thoughtBuffer.length
		if (totalSize >= this.minBufferSize) {
			acpLog.debug("UpdateBuffer", `Size threshold reached (${totalSize} >= ${this.minBufferSize}), flushing`)
			void this.flush()
			return
		}

		// Schedule delayed flush if not already scheduled
		this.scheduleFlush()
	}

	/**
	 * Schedule a delayed flush.
	 */
	private scheduleFlush(): void {
		if (this.flushTimer !== null) {
			return // Already scheduled
		}

		this.flushTimer = setTimeout(() => {
			this.flushTimer = null
			acpLog.debug("UpdateBuffer", "Flush timer expired")
			void this.flush()
		}, this.flushDelayMs)
	}

	/**
	 * Clear the flush timer.
	 */
	private clearFlushTimer(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer)
			this.flushTimer = null
		}
	}
}
