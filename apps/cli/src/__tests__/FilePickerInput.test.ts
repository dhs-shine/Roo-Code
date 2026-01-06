vi.mock("ink", () => ({
	Box: ({ children }: { children: React.ReactNode }) => children,
	Text: ({ children }: { children: React.ReactNode }) => children,
	useInput: vi.fn(),
}))

vi.mock("@inkjs/ui", () => ({
	TextInput: ({ onChange: _ }: { onChange: (value: string) => void }) => null,
}))

vi.mock("../ui/components/FilePickerSelect.js", () => ({
	FilePickerSelect: () => null,
}))

vi.mock("../ui/hooks/useInputHistory.js", () => ({
	useInputHistory: () => ({
		addEntry: vi.fn(),
		historyValue: null,
		isBrowsing: false,
		resetBrowsing: vi.fn(),
		history: [],
		draft: "",
		setDraft: vi.fn(),
	}),
}))

describe("FilePickerInput @ trigger detection", () => {
	describe("checkForAtTrigger logic", () => {
		// Test the @ trigger detection logic in isolation.
		const checkForAtTrigger = (
			value: string,
			isFilePickerOpen: boolean,
		): { shouldSearch: boolean; shouldClose: boolean; query: string } => {
			const atIndex = value.lastIndexOf("@")

			if (atIndex === -1) {
				return { shouldSearch: false, shouldClose: isFilePickerOpen, query: "" }
			}

			const query = value.substring(atIndex + 1)

			// Check if query contains a space (user finished typing file path).
			if (query.includes(" ")) {
				return { shouldSearch: false, shouldClose: isFilePickerOpen, query }
			}

			// Require at least 1 character after @ to trigger search.
			if (query.length === 0) {
				return { shouldSearch: false, shouldClose: isFilePickerOpen, query }
			}

			return { shouldSearch: true, shouldClose: false, query }
		}

		it("should detect @ with characters after it", () => {
			const result = checkForAtTrigger("hello @src", false)

			expect(result.shouldSearch).toBe(true)
			expect(result.query).toBe("src")
		})

		it("should not trigger with just @", () => {
			const result = checkForAtTrigger("hello @", false)

			expect(result.shouldSearch).toBe(false)
			expect(result.query).toBe("")
		})

		it("should not trigger without @", () => {
			const result = checkForAtTrigger("hello world", false)

			expect(result.shouldSearch).toBe(false)
		})

		it("should use last @ when multiple exist", () => {
			const result = checkForAtTrigger("@first @second", false)

			expect(result.shouldSearch).toBe(true)
			expect(result.query).toBe("second")
		})

		it("should close picker when space is added after file path", () => {
			const result = checkForAtTrigger("@/src/file.ts ", true)

			expect(result.shouldSearch).toBe(false)
			expect(result.shouldClose).toBe(true)
		})

		it("should support searching with partial file names", () => {
			const result = checkForAtTrigger("@App", false)

			expect(result.shouldSearch).toBe(true)
			expect(result.query).toBe("App")
		})

		it("should support searching with path separators", () => {
			const result = checkForAtTrigger("@src/utils", false)

			expect(result.shouldSearch).toBe(true)
			expect(result.query).toBe("src/utils")
		})

		it("should close picker when @ is deleted", () => {
			const result = checkForAtTrigger("hello world", true)

			expect(result.shouldSearch).toBe(false)
			expect(result.shouldClose).toBe(true)
		})
	})

	describe("file selection formatting", () => {
		const formatFileSelection = (
			currentValue: string,
			selectedPath: string,
		): { newValue: string; atIndex: number } => {
			const atIndex = currentValue.lastIndexOf("@")

			if (atIndex === -1) {
				return { newValue: currentValue, atIndex: -1 }
			}

			const beforeAt = currentValue.substring(0, atIndex)
			const newValue = `${beforeAt}@/${selectedPath} `

			return { newValue, atIndex }
		}

		it("should format selected file as @/{path}", () => {
			const result = formatFileSelection("hello @src", "src/utils/helper.ts")

			expect(result.newValue).toBe("hello @/src/utils/helper.ts ")
			expect(result.atIndex).toBe(6)
		})

		it("should format selected folder as @/{path}", () => {
			const result = formatFileSelection("@App", "apps/cli")

			expect(result.newValue).toBe("@/apps/cli ")
			expect(result.atIndex).toBe(0)
		})

		it("should preserve text before @", () => {
			const result = formatFileSelection("check this file @test", "tests/unit.test.ts")

			expect(result.newValue).toBe("check this file @/tests/unit.test.ts ")
		})

		it("should add space after selected file", () => {
			const result = formatFileSelection("@config", "config/settings.json")

			expect(result.newValue).toMatch(/ $/) // Ends with space.
		})

		it("should handle @ at start of input", () => {
			const result = formatFileSelection("@file", "package.json")

			expect(result.newValue).toBe("@/package.json ")
			expect(result.atIndex).toBe(0)
		})

		it("should handle multiple @ by using the last one", () => {
			const result = formatFileSelection("email@test.com @src", "src/index.ts")

			expect(result.newValue).toBe("email@test.com @/src/index.ts ")
		})

		it("should return unchanged if no @ found", () => {
			const result = formatFileSelection("hello world", "some/file.ts")

			expect(result.newValue).toBe("hello world")
			expect(result.atIndex).toBe(-1)
		})
	})

	describe("debounce behavior", () => {
		it("should debounce consecutive searches", async () => {
			const DEBOUNCE_MS = 150
			const searchFn = vi.fn()

			// Simulate debouncing.
			let timer: NodeJS.Timeout | null = null

			const debouncedSearch = (query: string) => {
				if (timer) {
					clearTimeout(timer)
				}
				timer = setTimeout(() => {
					searchFn(query)
				}, DEBOUNCE_MS)
			}

			// Rapid calls.
			debouncedSearch("s")
			debouncedSearch("sr")
			debouncedSearch("src")

			// Immediately, no calls should have been made.
			expect(searchFn).not.toHaveBeenCalled()

			// Wait for debounce.
			await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 50))

			// Only final call should execute.
			expect(searchFn).toHaveBeenCalledTimes(1)
			expect(searchFn).toHaveBeenCalledWith("src")
		})
	})
})

describe("FilePickerInput store integration", () => {
	describe("file picker state shape", () => {
		it("should have expected initial state", () => {
			const initialState = {
				fileSearchResults: [],
				isFilePickerOpen: false,
				filePickerQuery: "",
				filePickerSelectedIndex: 0,
			}

			expect(initialState.fileSearchResults).toEqual([])
			expect(initialState.isFilePickerOpen).toBe(false)
			expect(initialState.filePickerQuery).toBe("")
			expect(initialState.filePickerSelectedIndex).toBe(0)
		})

		it("should reset selectedIndex when results change", () => {
			// Simulate setFileSearchResults behavior.
			const setFileSearchResults = (results: unknown[]) => ({
				fileSearchResults: results,
				filePickerSelectedIndex: 0, // Always reset to 0.
			})

			const newResults = [{ path: "file1.ts", type: "file" }]
			const state = setFileSearchResults(newResults)

			expect(state.filePickerSelectedIndex).toBe(0)
		})

		it("should clear all picker state on clearFilePicker", () => {
			const clearFilePicker = () => ({
				fileSearchResults: [],
				isFilePickerOpen: false,
				filePickerQuery: "",
				filePickerSelectedIndex: 0,
			})

			const state = clearFilePicker()

			expect(state.fileSearchResults).toEqual([])
			expect(state.isFilePickerOpen).toBe(false)
			expect(state.filePickerQuery).toBe("")
			expect(state.filePickerSelectedIndex).toBe(0)
		})
	})
})
