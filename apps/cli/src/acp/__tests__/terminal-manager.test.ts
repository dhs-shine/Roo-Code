import type * as acp from "@agentclientprotocol/sdk"
import { describe, it, expect, beforeEach, vi } from "vitest"

import { TerminalManager } from "../terminal-manager.js"

// Mock the ACP SDK
vi.mock("@agentclientprotocol/sdk", () => ({
	TerminalHandle: class {
		id: string
		constructor(id: string) {
			this.id = id
		}
		async currentOutput() {
			return { output: "test output", truncated: false }
		}
		async waitForExit() {
			return { exitCode: 0, signal: null }
		}
		async kill() {
			return {}
		}
		async release() {
			return {}
		}
	},
}))

// Type definitions for mock objects
interface MockTerminalHandle {
	id: string
	currentOutput: ReturnType<typeof vi.fn>
	waitForExit: ReturnType<typeof vi.fn>
	kill: ReturnType<typeof vi.fn>
	release: ReturnType<typeof vi.fn>
}

interface MockConnection {
	createTerminal: ReturnType<typeof vi.fn>
	mockHandle: MockTerminalHandle
}

// Create a mock connection
function createMockConnection(): MockConnection {
	const mockHandle: MockTerminalHandle = {
		id: "term_mock123",
		currentOutput: vi.fn().mockResolvedValue({ output: "test output", truncated: false }),
		waitForExit: vi.fn().mockResolvedValue({ exitCode: 0, signal: null }),
		kill: vi.fn().mockResolvedValue({}),
		release: vi.fn().mockResolvedValue({}),
	}

	return {
		createTerminal: vi.fn().mockResolvedValue(mockHandle),
		mockHandle,
	}
}

describe("TerminalManager", () => {
	describe("parseCommand", () => {
		let manager: TerminalManager

		beforeEach(() => {
			const mockConnection = createMockConnection()
			manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)
		})

		it("parses a simple command without arguments", () => {
			const result = manager.parseCommand("ls")
			expect(result.executable).toBe("ls")
			expect(result.args).toEqual([])
			expect(result.fullCommand).toBe("ls")
			expect(result.cwd).toBeUndefined()
		})

		it("parses a command with arguments", () => {
			const result = manager.parseCommand("ls -la /tmp")
			expect(result.executable).toBe("ls")
			expect(result.args).toEqual(["-la", "/tmp"])
			expect(result.fullCommand).toBe("ls -la /tmp")
		})

		it("parses cd + command pattern", () => {
			const result = manager.parseCommand("cd /home/user && npm install")
			expect(result.cwd).toBe("/home/user")
			expect(result.executable).toBe("npm")
			expect(result.args).toEqual(["install"])
		})

		it("handles cd with complex path", () => {
			const result = manager.parseCommand("cd /path/to/project && git status")
			expect(result.cwd).toBe("/path/to/project")
			expect(result.executable).toBe("git")
			expect(result.args).toEqual(["status"])
		})

		it("wraps commands with shell operators in a shell", () => {
			const result = manager.parseCommand("echo hello | grep h")
			expect(result.executable).toBe("/bin/sh")
			expect(result.args).toEqual(["-c", "echo hello | grep h"])
		})

		it("wraps commands with && in a shell", () => {
			const result = manager.parseCommand("npm install && npm test")
			expect(result.executable).toBe("/bin/sh")
			expect(result.args).toEqual(["-c", "npm install && npm test"])
		})

		it("wraps commands with semicolons in a shell", () => {
			const result = manager.parseCommand("echo a; echo b")
			expect(result.executable).toBe("/bin/sh")
			expect(result.args).toEqual(["-c", "echo a; echo b"])
		})

		it("wraps commands with redirects in a shell", () => {
			const result = manager.parseCommand("echo hello > output.txt")
			expect(result.executable).toBe("/bin/sh")
			expect(result.args).toEqual(["-c", "echo hello > output.txt"])
		})

		it("handles whitespace-only input", () => {
			const result = manager.parseCommand("   ")
			expect(result.executable).toBe("")
			expect(result.args).toEqual([])
		})

		it("trims leading and trailing whitespace", () => {
			const result = manager.parseCommand("  ls -la  ")
			expect(result.executable).toBe("ls")
			expect(result.args).toEqual(["-la"])
		})

		it("handles npm commands", () => {
			const result = manager.parseCommand("npm run test")
			expect(result.executable).toBe("npm")
			expect(result.args).toEqual(["run", "test"])
		})

		it("handles npx commands", () => {
			const result = manager.parseCommand("npx vitest run src/test.ts")
			expect(result.executable).toBe("npx")
			expect(result.args).toEqual(["vitest", "run", "src/test.ts"])
		})
	})

	describe("terminal lifecycle", () => {
		it("creates a terminal and tracks it", async () => {
			const mockConnection = createMockConnection()
			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			const result = await manager.createTerminal("ls -la", "/home/user")

			expect(mockConnection.createTerminal).toHaveBeenCalledWith({
				sessionId: "session123",
				command: "ls",
				args: ["-la"],
				cwd: "/home/user",
			})

			expect(result.terminalId).toBe("term_mock123")
			expect(manager.hasTerminal("term_mock123")).toBe(true)
			expect(manager.activeCount).toBe(1)
		})

		it("releases a terminal and removes from tracking", async () => {
			const mockConnection = createMockConnection()
			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			await manager.createTerminal("ls", "/tmp")
			expect(manager.hasTerminal("term_mock123")).toBe(true)

			const released = await manager.releaseTerminal("term_mock123")
			expect(released).toBe(true)
			expect(manager.hasTerminal("term_mock123")).toBe(false)
			expect(manager.activeCount).toBe(0)
		})

		it("releases all terminals", async () => {
			const mockConnection = createMockConnection()
			let terminalCount = 0

			// Mock multiple terminal creations
			mockConnection.createTerminal = vi.fn().mockImplementation(() => {
				terminalCount++
				return Promise.resolve({
					id: `term_${terminalCount}`,
					currentOutput: vi.fn().mockResolvedValue({ output: "", truncated: false }),
					waitForExit: vi.fn().mockResolvedValue({ exitCode: 0, signal: null }),
					kill: vi.fn().mockResolvedValue({}),
					release: vi.fn().mockResolvedValue({}),
				})
			})

			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			await manager.createTerminal("ls", "/tmp")
			await manager.createTerminal("pwd", "/home")

			expect(manager.activeCount).toBe(2)

			await manager.releaseAll()

			expect(manager.activeCount).toBe(0)
		})

		it("returns null for unknown terminal operations", async () => {
			const mockConnection = createMockConnection()
			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			const output = await manager.getOutput("unknown_terminal")
			expect(output).toBeNull()

			const exitResult = await manager.waitForExit("unknown_terminal")
			expect(exitResult).toBeNull()

			const killResult = await manager.killTerminal("unknown_terminal")
			expect(killResult).toBe(false)

			const releaseResult = await manager.releaseTerminal("unknown_terminal")
			expect(releaseResult).toBe(false)
		})

		it("gets terminal info", async () => {
			const mockConnection = createMockConnection()
			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			await manager.createTerminal("ls -la", "/home/user", "tool-123")

			const info = manager.getTerminalInfo("term_mock123")
			expect(info).toBeDefined()
			expect(info?.command).toBe("ls -la")
			expect(info?.cwd).toBe("/home/user")
			expect(info?.toolCallId).toBe("tool-123")
		})

		it("gets active terminal IDs", async () => {
			const mockConnection = createMockConnection()
			let terminalCount = 0

			mockConnection.createTerminal = vi.fn().mockImplementation(() => {
				terminalCount++
				return Promise.resolve({
					id: `term_${terminalCount}`,
					currentOutput: vi.fn().mockResolvedValue({ output: "", truncated: false }),
					waitForExit: vi.fn().mockResolvedValue({ exitCode: 0, signal: null }),
					kill: vi.fn().mockResolvedValue({}),
					release: vi.fn().mockResolvedValue({}),
				})
			})

			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			await manager.createTerminal("ls", "/tmp")
			await manager.createTerminal("pwd", "/home")

			const ids = manager.getActiveTerminalIds()
			expect(ids).toHaveLength(2)
			expect(ids).toContain("term_1")
			expect(ids).toContain("term_2")
		})

		it("waits for terminal exit and returns result", async () => {
			const mockConnection = createMockConnection()
			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			await manager.createTerminal("ls", "/tmp")

			const result = await manager.waitForExit("term_mock123")

			expect(result).toEqual({
				exitCode: 0,
				signal: null,
				output: "test output",
			})
		})

		it("kills a terminal", async () => {
			const mockConnection = createMockConnection()
			const manager = new TerminalManager("session123", mockConnection as unknown as acp.AgentSideConnection)

			await manager.createTerminal("sleep 60", "/tmp")

			const killed = await manager.killTerminal("term_mock123")
			expect(killed).toBe(true)
			expect(mockConnection.mockHandle.kill).toHaveBeenCalled()
		})
	})
})
