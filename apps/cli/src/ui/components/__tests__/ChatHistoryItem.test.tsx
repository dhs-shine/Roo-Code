import { render } from "ink-testing-library"

import type { TUIMessage } from "../../types.js"
import ChatHistoryItem from "../ChatHistoryItem.js"

describe("ChatHistoryItem", () => {
	describe("content sanitization", () => {
		it("sanitizes tabs in user messages", () => {
			const message: TUIMessage = {
				id: "1",
				role: "user",
				content: "function test() {\n\treturn true;\n}",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Tabs should be replaced with 4 spaces
			expect(output).toContain("function test() {")
			expect(output).toContain("    return true;") // Tab replaced with 4 spaces
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in assistant messages", () => {
			const message: TUIMessage = {
				id: "2",
				role: "assistant",
				content: "Here's the code:\n\tconst x = 1;",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("    const x = 1;")
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in thinking messages", () => {
			const message: TUIMessage = {
				id: "3",
				role: "thinking",
				content: "Looking at:\n\tMarkdown example:\n\t```ts\n\t\tfunction foo() {}\n\t```",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// All tabs should be converted to spaces
			expect(output).not.toContain("\t")
			expect(output).toContain("    Markdown example:")
			expect(output).toContain("        function foo() {}") // Double-indented
		})

		it("sanitizes tabs in tool messages", () => {
			const message: TUIMessage = {
				id: "4",
				role: "tool",
				content: '{\n\t"key": "value"\n}',
				toolName: "read_file",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain('    "key": "value"')
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in tool messages with toolDisplayOutput", () => {
			const message: TUIMessage = {
				id: "5",
				role: "tool",
				content: "raw content",
				toolDisplayOutput: "function() {\n\treturn;\n}",
				toolName: "execute_command",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// toolDisplayOutput should be used and sanitized
			expect(output).toContain("    return;")
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in system messages", () => {
			const message: TUIMessage = {
				id: "6",
				role: "system",
				content: "System info:\n\tCPU: high",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("    CPU: high")
			expect(output).not.toContain("\t")
		})

		it("strips carriage returns from content", () => {
			const message: TUIMessage = {
				id: "7",
				role: "thinking",
				content: "Line 1\r\nLine 2\rLine 3",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Carriage returns should be stripped
			expect(output).not.toContain("\r")
			expect(output).toContain("Line 1")
			expect(output).toContain("Line 2")
			expect(output).toContain("Line 3")
		})

		it("strips carriage returns from toolDisplayOutput", () => {
			const message: TUIMessage = {
				id: "8",
				role: "tool",
				content: "raw",
				toolDisplayOutput: "Output\r\nwith\rCR",
				toolName: "test_tool",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).not.toContain("\r")
		})

		it("handles content with both tabs and carriage returns", () => {
			const message: TUIMessage = {
				id: "9",
				role: "thinking",
				content: "Code:\r\n\tfunction() {\r\n\t\treturn;\r\n\t}",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Both should be sanitized
			expect(output).not.toContain("\t")
			expect(output).not.toContain("\r")
			expect(output).toContain("    function()")
			expect(output).toContain("        return;") // Double-indented
		})
	})

	describe("message rendering", () => {
		it("renders user messages with correct header", () => {
			const message: TUIMessage = {
				id: "1",
				role: "user",
				content: "Hello",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("You said:")
			expect(output).toContain("Hello")
		})

		it("renders assistant messages with correct header", () => {
			const message: TUIMessage = {
				id: "2",
				role: "assistant",
				content: "Hi there",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("Roo said:")
			expect(output).toContain("Hi there")
		})

		it("renders thinking messages with correct header", () => {
			const message: TUIMessage = {
				id: "3",
				role: "thinking",
				content: "Let me think...",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("Roo is thinking:")
			expect(output).toContain("Let me think...")
		})

		it("renders tool messages with tool name", () => {
			const message: TUIMessage = {
				id: "4",
				role: "tool",
				content: "Output",
				toolName: "read_file",
				toolDisplayName: "Read File",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("tool - Read File")
			expect(output).toContain("Output")
		})

		it("uses fallback content when message.content is empty", () => {
			const message: TUIMessage = {
				id: "5",
				role: "assistant",
				content: "",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("...")
		})

		it("returns null for unknown role", () => {
			const message = {
				id: "6",
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				role: "unknown" as any,
				content: "Test",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			expect(lastFrame()).toBe("")
		})
	})
})
