import * as historyStorage from "../utils/historyStorage.js"

vi.mock("../utils/historyStorage.js")

// Track state and callbacks for testing.
let mockState: Record<string, unknown> = {}
let effectCallbacks: Array<() => void | (() => void)> = []

vi.mock("react", () => ({
	useState: vi.fn((initial: unknown) => {
		const key = `state_${Object.keys(mockState).length}`
		if (!(key in mockState)) {
			mockState[key] = initial
		}
		return [
			mockState[key],
			(newValue: unknown) => {
				if (typeof newValue === "function") {
					mockState[key] = (newValue as (prev: unknown) => unknown)(mockState[key])
				} else {
					mockState[key] = newValue
				}
			},
		]
	}),
	useEffect: vi.fn((callback: () => void | (() => void)) => {
		effectCallbacks.push(callback)
	}),
	useCallback: vi.fn((callback: unknown) => callback),
	useRef: vi.fn((initial: unknown) => ({ current: initial })),
}))

describe("useInputHistory", () => {
	beforeEach(() => {
		vi.resetAllMocks()
		mockState = {}
		effectCallbacks = []

		// Default mock for loadHistory
		vi.mocked(historyStorage.loadHistory).mockResolvedValue([])
		vi.mocked(historyStorage.addToHistory).mockImplementation(async (entry) => [entry])
	})

	describe("historyStorage functions", () => {
		it("loadHistory should be called when hook effect runs", async () => {
			vi.mocked(historyStorage.loadHistory).mockResolvedValue(["entry1", "entry2"])

			// Import the hook (this triggers the module initialization)
			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			useInputHistory()

			// Run the effect callbacks
			for (const cb of effectCallbacks) {
				cb()
			}

			expect(historyStorage.loadHistory).toHaveBeenCalled()
		})

		it("addToHistory should be called with trimmed entry", async () => {
			vi.mocked(historyStorage.addToHistory).mockResolvedValue(["new entry"])

			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			const result = useInputHistory()

			await result.addEntry("  new entry  ")

			expect(historyStorage.addToHistory).toHaveBeenCalledWith("new entry")
		})

		it("addToHistory should not be called for empty entries", async () => {
			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			const result = useInputHistory()

			await result.addEntry("")

			expect(historyStorage.addToHistory).not.toHaveBeenCalled()
		})

		it("addToHistory should not be called for whitespace-only entries", async () => {
			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			const result = useInputHistory()

			await result.addEntry("   ")

			expect(historyStorage.addToHistory).not.toHaveBeenCalled()
		})
	})

	describe("navigation logic", () => {
		it("should have initial state with no history value", async () => {
			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			const result = useInputHistory()

			// Initial state should have null history value (not browsing)
			expect(result.historyValue).toBeNull()
			expect(result.isBrowsing).toBe(false)
		})

		it("should export navigateUp and navigateDown functions for manual navigation", async () => {
			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			const result = useInputHistory()

			expect(typeof result.navigateUp).toBe("function")
			expect(typeof result.navigateDown).toBe("function")
		})
	})

	describe("resetBrowsing", () => {
		it("should be a function", async () => {
			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			const result = useInputHistory()

			expect(typeof result.resetBrowsing).toBe("function")
		})
	})

	describe("return value structure", () => {
		it("should return the expected interface", async () => {
			const { useInputHistory } = await import("../ui/hooks/useInputHistory.js")
			const result = useInputHistory()

			expect(result).toHaveProperty("addEntry")
			expect(result).toHaveProperty("historyValue")
			expect(result).toHaveProperty("isBrowsing")
			expect(result).toHaveProperty("resetBrowsing")
			expect(result).toHaveProperty("history")
			expect(result).toHaveProperty("draft")
			expect(result).toHaveProperty("navigateUp")
			expect(result).toHaveProperty("navigateDown")

			expect(typeof result.addEntry).toBe("function")
			expect(typeof result.resetBrowsing).toBe("function")
			expect(typeof result.navigateUp).toBe("function")
			expect(typeof result.navigateDown).toBe("function")
			expect(Array.isArray(result.history)).toBe(true)
		})
	})
})

describe("historyStorage integration", () => {
	// Test the actual historyStorage functions directly
	// These are more reliable than hook tests with mocked React

	beforeEach(() => {
		vi.resetAllMocks()
	})

	it("MAX_HISTORY_ENTRIES should be 500", async () => {
		const { MAX_HISTORY_ENTRIES } = await import("../utils/historyStorage.js")
		expect(MAX_HISTORY_ENTRIES).toBe(500)
	})

	it("getHistoryFilePath should return path in ~/.roo directory", async () => {
		// Un-mock for this test
		vi.doUnmock("../utils/historyStorage.js")
		const { getHistoryFilePath } = await import("../utils/historyStorage.js")

		const path = getHistoryFilePath()
		expect(path).toContain(".roo")
		expect(path).toContain("cli-history.json")
	})
})
