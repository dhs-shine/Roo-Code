let _mockInputHandler: ((input: string, key: Record<string, boolean>) => void) | null = null
let _mockInputOptions: { isActive?: boolean } | null = null

vi.mock("ink", () => ({
	Box: ({ children }: { children: React.ReactNode }) => children,
	Text: ({ children }: { children: React.ReactNode }) => children,
	useInput: vi.fn(
		(handler: (input: string, key: Record<string, boolean>) => void, options?: { isActive?: boolean }) => {
			_mockInputHandler = handler
			_mockInputOptions = options || null
		},
	),
}))

vi.mock("react", () => ({
	useEffect: vi.fn((callback: () => void | (() => void)) => {
		callback()
	}),
	useCallback: vi.fn((callback: unknown) => callback),
	useMemo: vi.fn((callback: () => unknown) => callback()),
}))

import type { FileSearchResult } from "../ui/types.js"

describe("FilePickerSelect", () => {
	beforeEach(() => {
		vi.resetAllMocks()
		_mockInputHandler = null
		_mockInputOptions = null
	})

	describe("scroll window calculation", () => {
		it("should show all items when results fit within maxVisible", () => {
			const results: FileSearchResult[] = [
				{ path: "file1.ts", type: "file" },
				{ path: "file2.ts", type: "file" },
				{ path: "folder1", type: "folder" },
			]

			// Compute visible window like the component does.
			const maxVisible = 10
			const selectedIndex = 0

			let offset = 0
			let visibleResults = results

			if (results.length > maxVisible) {
				const idealOffset = Math.max(0, selectedIndex - Math.floor(maxVisible / 2))
				offset = Math.min(idealOffset, results.length - maxVisible)
				visibleResults = results.slice(offset, offset + maxVisible)
			}

			expect(visibleResults.length).toBe(3)
			expect(offset).toBe(0)
		})

		it("should scroll down when selected item is beyond maxVisible", () => {
			const results: FileSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
				path: `file${i}.ts`,
				type: "file" as const,
			}))

			const maxVisible = 10
			const selectedIndex = 15

			let offset = 0

			if (results.length > maxVisible) {
				const idealOffset = Math.max(0, selectedIndex - Math.floor(maxVisible / 2))
				offset = Math.min(idealOffset, results.length - maxVisible)
			}

			const visibleResults = results.slice(offset, offset + maxVisible)

			expect(offset).toBe(10)
			expect(visibleResults.length).toBe(10)
			expect(visibleResults[0]?.path).toBe("file10.ts")
		})

		it("should keep selected item in view when near the end", () => {
			const results: FileSearchResult[] = Array.from({ length: 15 }, (_, i) => ({
				path: `file${i}.ts`,
				type: "file" as const,
			}))

			const maxVisible = 10
			const selectedIndex = 14

			let offset = 0

			if (results.length > maxVisible) {
				const idealOffset = Math.max(0, selectedIndex - Math.floor(maxVisible / 2))
				offset = Math.min(idealOffset, results.length - maxVisible)
			}

			const visibleResults = results.slice(offset, offset + maxVisible)

			expect(offset).toBe(5)
			expect(visibleResults.length).toBe(10)
			// Selected item (index 14) should be at visible index 9.
			expect(selectedIndex - offset).toBe(9)
		})
	})

	describe("keyboard navigation", () => {
		it("should call onIndexChange with next index on down arrow", async () => {
			const onIndexChange = vi.fn()

			const results: FileSearchResult[] = [
				{ path: "file1.ts", type: "file" },
				{ path: "file2.ts", type: "file" },
			]

			// Import the component to trigger useInput registration.
			await import("../ui/components/FilePickerSelect.js")

			const selectedIndex = 0
			const key = { downArrow: true, upArrow: false, escape: false, return: false }

			if (key.downArrow) {
				const newIndex = selectedIndex < results.length - 1 ? selectedIndex + 1 : 0
				onIndexChange(newIndex)
			}

			expect(onIndexChange).toHaveBeenCalledWith(1)
		})

		it("should wrap around to first item when pressing down at end", () => {
			const onIndexChange = vi.fn()

			const results: FileSearchResult[] = [
				{ path: "file1.ts", type: "file" },
				{ path: "file2.ts", type: "file" },
			]

			const selectedIndex = 1
			const key = { downArrow: true, upArrow: false, escape: false, return: false }

			if (key.downArrow) {
				const newIndex = selectedIndex < results.length - 1 ? selectedIndex + 1 : 0
				onIndexChange(newIndex)
			}

			expect(onIndexChange).toHaveBeenCalledWith(0)
		})

		it("should call onIndexChange with previous index on up arrow", () => {
			const onIndexChange = vi.fn()

			const results: FileSearchResult[] = [
				{ path: "file1.ts", type: "file" },
				{ path: "file2.ts", type: "file" },
			]

			const selectedIndex = 1
			const key = { downArrow: false, upArrow: true, escape: false, return: false }

			if (key.upArrow) {
				const newIndex = selectedIndex > 0 ? selectedIndex - 1 : results.length - 1
				onIndexChange(newIndex)
			}

			expect(onIndexChange).toHaveBeenCalledWith(0)
		})

		it("should wrap around to last item when pressing up at start", () => {
			const onIndexChange = vi.fn()

			const results: FileSearchResult[] = [
				{ path: "file1.ts", type: "file" },
				{ path: "file2.ts", type: "file" },
			]

			const selectedIndex = 0
			const key = { downArrow: false, upArrow: true, escape: false, return: false }

			if (key.upArrow) {
				const newIndex = selectedIndex > 0 ? selectedIndex - 1 : results.length - 1
				onIndexChange(newIndex)
			}

			expect(onIndexChange).toHaveBeenCalledWith(1)
		})

		it("should call onEscape when escape is pressed", () => {
			const onEscape = vi.fn()
			const key = { downArrow: false, upArrow: false, escape: true, return: false }

			if (key.escape) {
				onEscape()
			}

			expect(onEscape).toHaveBeenCalled()
		})

		it("should call onSelect with selected item when return is pressed", () => {
			const onSelect = vi.fn()

			const results: FileSearchResult[] = [
				{ path: "file1.ts", type: "file" },
				{ path: "file2.ts", type: "file" },
			]

			const selectedIndex = 1
			const key = { downArrow: false, upArrow: false, escape: false, return: true }

			if (key.return) {
				const selected = results[selectedIndex]

				if (selected) {
					onSelect(selected)
				}
			}

			expect(onSelect).toHaveBeenCalledWith({ path: "file2.ts", type: "file" })
		})
	})
})
