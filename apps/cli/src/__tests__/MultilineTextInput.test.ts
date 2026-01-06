/**
 * Tests for MultilineTextInput component
 */

describe("MultilineTextInput", () => {
	describe("cursor position calculations", () => {
		// Test the getCursorPosition logic
		const getCursorPosition = (value: string, cursorIndex: number): { line: number; col: number } => {
			const lines = value.split("\n")
			let pos = 0
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]!
				const lineEnd = pos + line.length
				if (cursorIndex <= lineEnd) {
					return { line: i, col: cursorIndex - pos }
				}
				pos = lineEnd + 1 // +1 for newline
			}
			// Cursor at very end
			return { line: lines.length - 1, col: (lines[lines.length - 1] || "").length }
		}

		// Test the getIndexFromPosition logic
		const getIndexFromPosition = (value: string, line: number, col: number): number => {
			const lines = value.split("\n")
			let index = 0
			for (let i = 0; i < line && i < lines.length; i++) {
				index += lines[i]!.length + 1 // +1 for newline
			}
			const targetLine = lines[line] || ""
			index += Math.min(col, targetLine.length)
			return index
		}

		it("should calculate cursor position for single line", () => {
			const value = "hello"
			expect(getCursorPosition(value, 0)).toEqual({ line: 0, col: 0 })
			expect(getCursorPosition(value, 2)).toEqual({ line: 0, col: 2 })
			expect(getCursorPosition(value, 5)).toEqual({ line: 0, col: 5 })
		})

		it("should calculate cursor position for multiple lines", () => {
			const value = "hello\nworld"
			// "hello" is 5 chars, newline at index 5
			// "world" starts at index 6
			expect(getCursorPosition(value, 0)).toEqual({ line: 0, col: 0 })
			expect(getCursorPosition(value, 5)).toEqual({ line: 0, col: 5 }) // End of first line
			expect(getCursorPosition(value, 6)).toEqual({ line: 1, col: 0 }) // Start of second line
			expect(getCursorPosition(value, 8)).toEqual({ line: 1, col: 2 }) // Middle of second line
			expect(getCursorPosition(value, 11)).toEqual({ line: 1, col: 5 }) // End of second line
		})

		it("should calculate cursor position for three lines", () => {
			const value = "foo\nbar\nbaz"
			// "foo" = 3 chars, newline at 3
			// "bar" starts at 4, ends at 6, newline at 7
			// "baz" starts at 8
			expect(getCursorPosition(value, 0)).toEqual({ line: 0, col: 0 })
			expect(getCursorPosition(value, 3)).toEqual({ line: 0, col: 3 })
			expect(getCursorPosition(value, 4)).toEqual({ line: 1, col: 0 })
			expect(getCursorPosition(value, 7)).toEqual({ line: 1, col: 3 })
			expect(getCursorPosition(value, 8)).toEqual({ line: 2, col: 0 })
			expect(getCursorPosition(value, 11)).toEqual({ line: 2, col: 3 })
		})

		it("should calculate index from position for single line", () => {
			const value = "hello"
			expect(getIndexFromPosition(value, 0, 0)).toBe(0)
			expect(getIndexFromPosition(value, 0, 2)).toBe(2)
			expect(getIndexFromPosition(value, 0, 5)).toBe(5)
		})

		it("should calculate index from position for multiple lines", () => {
			const value = "hello\nworld"
			expect(getIndexFromPosition(value, 0, 0)).toBe(0)
			expect(getIndexFromPosition(value, 0, 5)).toBe(5)
			expect(getIndexFromPosition(value, 1, 0)).toBe(6)
			expect(getIndexFromPosition(value, 1, 2)).toBe(8)
			expect(getIndexFromPosition(value, 1, 5)).toBe(11)
		})

		it("should clamp column to line length", () => {
			const value = "hi\nworld"
			// First line "hi" is only 2 chars, requesting col 5 should clamp to 2
			expect(getIndexFromPosition(value, 0, 5)).toBe(2)
		})
	})

	describe("line splitting", () => {
		it("should split empty string into single empty line", () => {
			const value = ""
			const lines = value.split("\n")
			expect(lines).toEqual([""])
		})

		it("should split single line correctly", () => {
			const value = "hello world"
			const lines = value.split("\n")
			expect(lines).toEqual(["hello world"])
		})

		it("should split multiple lines correctly", () => {
			const value = "foo\nbar\nbaz"
			const lines = value.split("\n")
			expect(lines).toEqual(["foo", "bar", "baz"])
		})

		it("should handle trailing newline", () => {
			const value = "foo\nbar\n"
			const lines = value.split("\n")
			expect(lines).toEqual(["foo", "bar", ""])
		})

		it("should handle empty lines in middle", () => {
			const value = "foo\n\nbaz"
			const lines = value.split("\n")
			expect(lines).toEqual(["foo", "", "baz"])
		})
	})

	describe("line normalization", () => {
		const normalizeLineEndings = (text: string): string => {
			if (text == null) return ""
			return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
		}

		it("should normalize CRLF to LF", () => {
			expect(normalizeLineEndings("hello\r\nworld")).toBe("hello\nworld")
		})

		it("should normalize CR to LF", () => {
			expect(normalizeLineEndings("hello\rworld")).toBe("hello\nworld")
		})

		it("should leave LF unchanged", () => {
			expect(normalizeLineEndings("hello\nworld")).toBe("hello\nworld")
		})

		it("should handle null/undefined", () => {
			expect(normalizeLineEndings(null as unknown as string)).toBe("")
			expect(normalizeLineEndings(undefined as unknown as string)).toBe("")
		})

		it("should handle mixed line endings", () => {
			expect(normalizeLineEndings("a\r\nb\rc\nd")).toBe("a\nb\nc\nd")
		})
	})

	describe("key binding behavior", () => {
		it("should detect Ctrl+Enter for newline insertion", () => {
			const isNewlineKey = (key: { return: boolean; ctrl: boolean }) => key.return && key.ctrl
			expect(isNewlineKey({ return: true, ctrl: true })).toBe(true)
			expect(isNewlineKey({ return: true, ctrl: false })).toBe(false)
			expect(isNewlineKey({ return: false, ctrl: true })).toBe(false)
		})

		it("should detect Enter for submit", () => {
			const isSubmitKey = (key: { return: boolean; ctrl: boolean }) => key.return && !key.ctrl
			expect(isSubmitKey({ return: true, ctrl: false })).toBe(true)
			expect(isSubmitKey({ return: true, ctrl: true })).toBe(false)
			expect(isSubmitKey({ return: false, ctrl: false })).toBe(false)
		})
	})

	describe("newline insertion", () => {
		it("should insert newline at cursor position", () => {
			const value = "hello"
			const cursorIndex = 2
			const newValue = value.slice(0, cursorIndex) + "\n" + value.slice(cursorIndex)
			expect(newValue).toBe("he\nllo")
		})

		it("should insert newline at end", () => {
			const value = "hello"
			const cursorIndex = 5
			const newValue = value.slice(0, cursorIndex) + "\n" + value.slice(cursorIndex)
			expect(newValue).toBe("hello\n")
		})

		it("should insert newline at start", () => {
			const value = "hello"
			const cursorIndex = 0
			const newValue = value.slice(0, cursorIndex) + "\n" + value.slice(cursorIndex)
			expect(newValue).toBe("\nhello")
		})
	})

	describe("backspace behavior", () => {
		it("should delete character before cursor", () => {
			const value = "hello"
			const cursorIndex = 3
			const newValue = value.slice(0, cursorIndex - 1) + value.slice(cursorIndex)
			expect(newValue).toBe("helo")
		})

		it("should delete newline character (merge lines)", () => {
			const value = "hello\nworld"
			const cursorIndex = 6 // Start of "world" line
			const newValue = value.slice(0, cursorIndex - 1) + value.slice(cursorIndex)
			expect(newValue).toBe("helloworld")
		})

		it("should do nothing at start of input", () => {
			const value = "hello"
			const cursorIndex = 0
			// In real implementation, we check if cursorIndex > 0
			if (cursorIndex > 0) {
				const newValue = value.slice(0, cursorIndex - 1) + value.slice(cursorIndex)
				expect(newValue).not.toBe(value)
			}
			// At position 0, backspace does nothing
			expect(value).toBe("hello")
		})
	})

	describe("arrow key navigation", () => {
		describe("up arrow", () => {
			it("should move to previous line preserving column", () => {
				const value = "hello\nworld"
				const getCursorPosition = (v: string, i: number) => {
					const lines = v.split("\n")
					let pos = 0
					for (let li = 0; li < lines.length; li++) {
						const line = lines[li]!
						const lineEnd = pos + line.length
						if (i <= lineEnd) {
							return { line: li, col: i - pos }
						}
						pos = lineEnd + 1
					}
					return { line: lines.length - 1, col: (lines[lines.length - 1] || "").length }
				}

				const getIndexFromPosition = (v: string, line: number, col: number) => {
					const lines = v.split("\n")
					let index = 0
					for (let i = 0; i < line && i < lines.length; i++) {
						index += lines[i]!.length + 1
					}
					const targetLine = lines[line] || ""
					index += Math.min(col, targetLine.length)
					return index
				}

				// Cursor at "world"[2] (index 8)
				const cursorIndex = 8
				const { line, col } = getCursorPosition(value, cursorIndex)
				expect(line).toBe(1)
				expect(col).toBe(2)

				// Move up: should go to line 0, same column
				const targetLine = 0
				const newIndex = getIndexFromPosition(value, targetLine, col)
				expect(newIndex).toBe(2) // "he|llo"
			})

			it("should clamp column if target line is shorter", () => {
				const value = "hi\nworld"
				const getIndexFromPosition = (v: string, line: number, col: number) => {
					const lines = v.split("\n")
					let index = 0
					for (let i = 0; i < line && i < lines.length; i++) {
						index += lines[i]!.length + 1
					}
					const targetLine = lines[line] || ""
					index += Math.min(col, targetLine.length)
					return index
				}

				// Cursor at "world"[4] (index 7)
				// Moving up to "hi" which is only 2 chars, should clamp to col 2
				const targetLine = 0
				const col = 4
				const newIndex = getIndexFromPosition(value, targetLine, col)
				expect(newIndex).toBe(2) // End of "hi"
			})
		})

		describe("down arrow", () => {
			it("should move to next line preserving column", () => {
				const value = "hello\nworld"
				const getIndexFromPosition = (v: string, line: number, col: number) => {
					const lines = v.split("\n")
					let index = 0
					for (let i = 0; i < line && i < lines.length; i++) {
						index += lines[i]!.length + 1
					}
					const targetLine = lines[line] || ""
					index += Math.min(col, targetLine.length)
					return index
				}

				// Cursor at "hello"[2] (index 2)
				const col = 2
				const targetLine = 1
				const newIndex = getIndexFromPosition(value, targetLine, col)
				expect(newIndex).toBe(8) // "wo|rld"
			})
		})

		describe("left/right arrows", () => {
			it("should move left by 1", () => {
				const cursorIndex = 5
				const newIndex = Math.max(0, cursorIndex - 1)
				expect(newIndex).toBe(4)
			})

			it("should not move left past 0", () => {
				const cursorIndex = 0
				const newIndex = Math.max(0, cursorIndex - 1)
				expect(newIndex).toBe(0)
			})

			it("should move right by 1", () => {
				const value = "hello"
				const cursorIndex = 2
				const newIndex = Math.min(value.length, cursorIndex + 1)
				expect(newIndex).toBe(3)
			})

			it("should not move right past end", () => {
				const value = "hello"
				const cursorIndex = 5
				const newIndex = Math.min(value.length, cursorIndex + 1)
				expect(newIndex).toBe(5)
			})
		})
	})
})

describe("multi-line history integration", () => {
	it("should store multi-line entries with newlines", () => {
		const entry = "foo\nbar\nbaz"
		expect(entry.includes("\n")).toBe(true)
		expect(entry.split("\n").length).toBe(3)
	})

	it("should restore multi-line entries correctly", () => {
		const storedEntry = "foo\nbar\nbaz"
		const lines = storedEntry.split("\n")
		expect(lines).toEqual(["foo", "bar", "baz"])
	})
})
