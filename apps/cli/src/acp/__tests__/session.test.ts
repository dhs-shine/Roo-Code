import type * as acp from "@agentclientprotocol/sdk"

vi.mock("@/agent/extension-host.js", () => {
	const mockClient = {
		on: vi.fn().mockReturnThis(),
		off: vi.fn().mockReturnThis(),
		respond: vi.fn(),
		approve: vi.fn(),
		reject: vi.fn(),
	}

	return {
		ExtensionHost: vi.fn().mockImplementation(() => ({
			client: mockClient,
			activate: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			sendToExtension: vi.fn(),
		})),
	}
})

import { AcpSession, type AcpSessionOptions } from "../session.js"
import { ExtensionHost } from "@/agent/extension-host.js"

describe("AcpSession", () => {
	let mockConnection: acp.AgentSideConnection

	const defaultOptions: AcpSessionOptions = {
		extensionPath: "/test/extension",
		provider: "openrouter",
		apiKey: "test-api-key",
		model: "test-model",
		mode: "code",
	}

	beforeEach(() => {
		mockConnection = {
			sessionUpdate: vi.fn().mockResolvedValue(undefined),
			requestPermission: vi.fn().mockResolvedValue({
				outcome: { outcome: "selected", optionId: "allow" },
			}),
			readTextFile: vi.fn().mockResolvedValue({ content: "test content" }),
			writeTextFile: vi.fn().mockResolvedValue({}),
			createTerminal: vi.fn(),
			extMethod: vi.fn(),
			extNotification: vi.fn(),
			signal: new AbortController().signal,
			closed: Promise.resolve(),
		} as unknown as acp.AgentSideConnection

		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("create", () => {
		it("should create a session with a unique ID", async () => {
			const session = await AcpSession.create(
				"test-session-1",
				"/test/workspace",
				mockConnection,
				undefined,
				defaultOptions,
			)

			expect(session).toBeDefined()
			expect(session.getSessionId()).toBe("test-session-1")
		})

		it("should create ExtensionHost with correct config", async () => {
			await AcpSession.create("test-session-2", "/test/workspace", mockConnection, undefined, defaultOptions)

			expect(ExtensionHost).toHaveBeenCalledWith(
				expect.objectContaining({
					extensionPath: "/test/extension",
					workspacePath: "/test/workspace",
					provider: "openrouter",
					apiKey: "test-api-key",
					model: "test-model",
					mode: "code",
				}),
			)
		})

		it("should accept client capabilities", async () => {
			const clientCapabilities: acp.ClientCapabilities = {
				fs: {
					readTextFile: true,
					writeTextFile: true,
				},
			}

			const session = await AcpSession.create(
				"test-session-3",
				"/test/workspace",
				mockConnection,
				clientCapabilities,
				defaultOptions,
			)

			expect(session).toBeDefined()
		})

		it("should activate the extension host", async () => {
			await AcpSession.create("test-session-4", "/test/workspace", mockConnection, undefined, defaultOptions)

			const mockHostInstance = vi.mocked(ExtensionHost).mock.results[0]!.value
			expect(mockHostInstance.activate).toHaveBeenCalled()
		})
	})

	describe("prompt", () => {
		it("should send a task to the extension host", async () => {
			const session = await AcpSession.create(
				"test-session",
				"/test/workspace",
				mockConnection,
				undefined,
				defaultOptions,
			)

			const mockHostInstance = vi.mocked(ExtensionHost).mock.results[0]!.value

			// Start the prompt (don't await - it waits for taskCompleted event)
			const promptPromise = session.prompt({
				sessionId: "test-session",
				prompt: [{ type: "text", text: "Hello, world!" }],
			})

			// Verify the task was sent
			expect(mockHostInstance.sendToExtension).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "newTask",
					text: "Hello, world!",
				}),
			)

			// Cancel to resolve the promise
			session.cancel()
			const result = await promptPromise
			expect(result.stopReason).toBe("cancelled")
		})

		it("should handle image prompts", async () => {
			const session = await AcpSession.create(
				"test-session",
				"/test/workspace",
				mockConnection,
				undefined,
				defaultOptions,
			)

			const mockHostInstance = vi.mocked(ExtensionHost).mock.results[0]!.value

			const promptPromise = session.prompt({
				sessionId: "test-session",
				prompt: [
					{ type: "text", text: "Describe this image" },
					{ type: "image", mimeType: "image/png", data: "base64data" },
				],
			})

			// Images are extracted as raw base64 data, text includes [image content] placeholder
			expect(mockHostInstance.sendToExtension).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "newTask",
					images: expect.arrayContaining(["base64data"]),
				}),
			)

			session.cancel()
			await promptPromise
		})
	})

	describe("cancel", () => {
		it("should send cancel message to extension host", async () => {
			const session = await AcpSession.create(
				"test-session",
				"/test/workspace",
				mockConnection,
				undefined,
				defaultOptions,
			)

			const mockHostInstance = vi.mocked(ExtensionHost).mock.results[0]!.value

			// Start a prompt first
			const promptPromise = session.prompt({
				sessionId: "test-session",
				prompt: [{ type: "text", text: "Hello" }],
			})

			// Cancel
			session.cancel()

			expect(mockHostInstance.sendToExtension).toHaveBeenCalledWith({ type: "cancelTask" })

			await promptPromise
		})
	})

	describe("setMode", () => {
		it("should update the session mode", async () => {
			const session = await AcpSession.create(
				"test-session",
				"/test/workspace",
				mockConnection,
				undefined,
				defaultOptions,
			)

			const mockHostInstance = vi.mocked(ExtensionHost).mock.results[0]!.value

			session.setMode("architect")

			expect(mockHostInstance.sendToExtension).toHaveBeenCalledWith({
				type: "updateSettings",
				updatedSettings: { mode: "architect" },
			})
		})
	})

	describe("dispose", () => {
		it("should dispose the extension host", async () => {
			const session = await AcpSession.create(
				"test-session",
				"/test/workspace",
				mockConnection,
				undefined,
				defaultOptions,
			)

			const mockHostInstance = vi.mocked(ExtensionHost).mock.results[0]!.value

			await session.dispose()

			expect(mockHostInstance.dispose).toHaveBeenCalled()
		})
	})

	describe("getSessionId", () => {
		it("should return the session ID", async () => {
			const session = await AcpSession.create(
				"my-unique-session-id",
				"/test/workspace",
				mockConnection,
				undefined,
				defaultOptions,
			)

			expect(session.getSessionId()).toBe("my-unique-session-id")
		})
	})
})
