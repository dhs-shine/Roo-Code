/**
 * Tests for UpdateBuffer
 *
 * Verifies that the buffer correctly batches text chunk updates
 * while passing through other updates immediately.
 */

import type * as acp from "@agentclientprotocol/sdk"

import { UpdateBuffer } from "../update-buffer.js"

type SessionUpdate = acp.SessionNotification["update"]

describe("UpdateBuffer", () => {
	let sentUpdates: Array<{ sessionUpdate: string; content?: unknown }>
	let sendUpdate: (update: SessionUpdate) => Promise<void>

	beforeEach(() => {
		sentUpdates = []
		sendUpdate = vi.fn(async (update) => {
			sentUpdates.push(update)
		})
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("text chunk buffering", () => {
		it("should buffer agent_message_chunk updates", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 100,
				flushDelayMs: 50,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" },
			})

			// Should not be sent immediately
			expect(sentUpdates).toHaveLength(0)
			expect(buffer.getBufferSizes().message).toBe(5)
		})

		it("should buffer agent_thought_chunk updates", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 100,
				flushDelayMs: 50,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "Thinking..." },
			})

			// Should not be sent immediately
			expect(sentUpdates).toHaveLength(0)
			expect(buffer.getBufferSizes().thought).toBe(11)
		})

		it("should batch multiple text chunks together", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 100,
				flushDelayMs: 50,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello " },
			})
			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "World" },
			})

			expect(sentUpdates).toHaveLength(0)
			expect(buffer.getBufferSizes().message).toBe(11)

			// Flush and check combined content
			await buffer.flush()
			expect(sentUpdates).toHaveLength(1)
			expect(sentUpdates[0]).toEqual({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello World" },
			})
		})
	})

	describe("size threshold flushing", () => {
		it("should flush when buffer reaches minBufferSize", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 10,
				flushDelayMs: 1000, // Long delay to ensure size triggers flush
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello World!" }, // 12 chars, exceeds 10
			})

			// Should have flushed due to size
			expect(sentUpdates).toHaveLength(1)
			expect(sentUpdates[0]).toEqual({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello World!" },
			})
		})

		it("should consider combined buffer sizes", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 15,
				flushDelayMs: 1000,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" }, // 5 chars
			})
			await buffer.queueUpdate({
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "Thinking!" }, // 9 chars, total 14
			})

			// Not flushed yet (14 < 15)
			expect(sentUpdates).toHaveLength(0)

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "X" }, // 1 more, total 15
			})

			// Should have flushed (15 >= 15)
			expect(sentUpdates).toHaveLength(2) // message and thought
		})
	})

	describe("time threshold flushing", () => {
		it("should flush after flushDelayMs", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 50,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" },
			})

			expect(sentUpdates).toHaveLength(0)

			// Advance time past the flush delay
			await vi.advanceTimersByTimeAsync(60)

			expect(sentUpdates).toHaveLength(1)
			expect(sentUpdates[0]).toEqual({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" },
			})
		})

		it("should reset timer on new content", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 50,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "A" },
			})

			// Advance 30ms (not enough to flush)
			await vi.advanceTimersByTimeAsync(30)
			expect(sentUpdates).toHaveLength(0)

			// Add more content (should NOT reset timer in current impl)
			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "B" },
			})

			// Advance another 30ms (total 60ms from first queue)
			await vi.advanceTimersByTimeAsync(30)

			// Should have flushed
			expect(sentUpdates).toHaveLength(1)
			expect(sentUpdates[0]!.content).toEqual({ type: "text", text: "AB" })
		})
	})

	describe("non-bufferable updates", () => {
		it("should send tool_call updates immediately", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 1000,
			})

			await buffer.queueUpdate({
				sessionUpdate: "tool_call",
				toolCallId: "test-123",
				title: "Test Tool",
				kind: "read",
				status: "in_progress",
			})

			// Should be sent immediately
			expect(sentUpdates).toHaveLength(1)
			expect(sentUpdates[0]!.sessionUpdate).toBe("tool_call")
		})

		it("should send tool_call_update updates immediately", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 1000,
			})

			await buffer.queueUpdate({
				sessionUpdate: "tool_call_update",
				toolCallId: "test-123",
				status: "completed",
			})

			expect(sentUpdates).toHaveLength(1)
			expect(sentUpdates[0]!.sessionUpdate).toBe("tool_call_update")
		})

		it("should flush buffered content before sending non-bufferable update", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 1000,
			})

			// Buffer some text first
			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Before tool" },
			})

			// Send tool call - should flush text first
			await buffer.queueUpdate({
				sessionUpdate: "tool_call",
				toolCallId: "test-123",
				title: "Test Tool",
				kind: "read",
				status: "in_progress",
			})

			// Text should come first, then tool call
			expect(sentUpdates).toHaveLength(2)
			expect(sentUpdates[0]!.sessionUpdate).toBe("agent_message_chunk")
			expect(sentUpdates[1]!.sessionUpdate).toBe("tool_call")
		})
	})

	describe("flush method", () => {
		it("should flush all buffered content", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 1000,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Message" },
			})
			await buffer.queueUpdate({
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "Thought" },
			})

			expect(sentUpdates).toHaveLength(0)

			await buffer.flush()

			expect(sentUpdates).toHaveLength(2)
			expect(sentUpdates[0]!.sessionUpdate).toBe("agent_message_chunk")
			expect(sentUpdates[1]!.sessionUpdate).toBe("agent_thought_chunk")
		})

		it("should be idempotent when buffer is empty", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 1000,
			})

			await buffer.flush()
			await buffer.flush()
			await buffer.flush()

			expect(sentUpdates).toHaveLength(0)
		})
	})

	describe("reset method", () => {
		it("should clear all buffered content", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 1000,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" },
			})

			expect(buffer.getBufferSizes().message).toBe(5)

			buffer.reset()

			expect(buffer.getBufferSizes().message).toBe(0)
			expect(buffer.getBufferSizes().thought).toBe(0)

			// Flushing should send nothing
			await buffer.flush()
			expect(sentUpdates).toHaveLength(0)
		})

		it("should cancel pending flush timer", async () => {
			const buffer = new UpdateBuffer(sendUpdate, {
				minBufferSize: 1000,
				flushDelayMs: 50,
			})

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" },
			})

			buffer.reset()

			// Advance past flush delay
			await vi.advanceTimersByTimeAsync(100)

			// Nothing should have been sent
			expect(sentUpdates).toHaveLength(0)
		})
	})

	describe("default options", () => {
		it("should use defaults (200 chars, 500ms)", async () => {
			const buffer = new UpdateBuffer(sendUpdate)

			// Default minBufferSize is 200
			const longText = "A".repeat(199)
			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: longText },
			})

			// Not flushed yet (199 < 200)
			expect(sentUpdates).toHaveLength(0)

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "B" }, // 200 total
			})

			// Should have flushed (200 >= 200)
			expect(sentUpdates).toHaveLength(1)
		})

		it("should flush after 500ms by default", async () => {
			const buffer = new UpdateBuffer(sendUpdate)

			await buffer.queueUpdate({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" },
			})

			// Not flushed at 400ms
			await vi.advanceTimersByTimeAsync(400)
			expect(sentUpdates).toHaveLength(0)

			// Flushed at 500ms
			await vi.advanceTimersByTimeAsync(150)
			expect(sentUpdates).toHaveLength(1)
		})
	})
})
