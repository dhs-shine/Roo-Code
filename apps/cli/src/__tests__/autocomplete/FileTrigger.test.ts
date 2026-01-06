import { describe, it, expect, vi } from "vitest"
import {
	createFileTrigger,
	toFileResult,
	type FileResult,
} from "../../ui/components/autocomplete/triggers/FileTrigger.js"

describe("FileTrigger", () => {
	describe("toFileResult", () => {
		it("should convert FileSearchResult to FileResult with key", () => {
			const input = { path: "src/test.ts", type: "file" as const }
			const result = toFileResult(input)

			expect(result).toEqual({
				key: "src/test.ts",
				path: "src/test.ts",
				type: "file",
				label: undefined,
			})
		})

		it("should include label if provided", () => {
			const input = { path: "src/", type: "folder" as const, label: "Source" }
			const result = toFileResult(input)

			expect(result).toEqual({
				key: "src/",
				path: "src/",
				type: "folder",
				label: "Source",
			})
		})
	})

	describe("detectTrigger", () => {
		const onSearch = vi.fn()
		const getResults = (): FileResult[] => []
		const trigger = createFileTrigger({ onSearch, getResults })

		it("should detect @ trigger with query", () => {
			const result = trigger.detectTrigger("hello @test")

			expect(result).toEqual({
				query: "test",
				triggerIndex: 6,
			})
		})

		it("should return null when no @ present", () => {
			const result = trigger.detectTrigger("hello world")

			expect(result).toBeNull()
		})

		it("should return null when query contains space", () => {
			const result = trigger.detectTrigger("hello @test file")

			expect(result).toBeNull()
		})

		it("should return null when query is empty", () => {
			const result = trigger.detectTrigger("hello @")

			expect(result).toBeNull()
		})

		it("should find last @ in line", () => {
			const result = trigger.detectTrigger("email@test.com @file")

			expect(result).toEqual({
				query: "file",
				triggerIndex: 15,
			})
		})
	})

	describe("getReplacementText", () => {
		const onSearch = vi.fn()
		const getResults = (): FileResult[] => []
		const trigger = createFileTrigger({ onSearch, getResults })

		it("should replace @ trigger with file path", () => {
			const item: FileResult = { key: "src/test.ts", path: "src/test.ts", type: "file" }
			const result = trigger.getReplacementText(item, "hello @tes", 6)

			expect(result).toBe("hello @/src/test.ts ")
		})

		it("should preserve text before @", () => {
			const item: FileResult = { key: "config.json", path: "config.json", type: "file" }
			const result = trigger.getReplacementText(item, "check @co", 6)

			expect(result).toBe("check @/config.json ")
		})
	})

	describe("search", () => {
		it("should call onSearch and return current results", () => {
			const onSearch = vi.fn()
			const mockResults: FileResult[] = [{ key: "test.ts", path: "test.ts", type: "file" }]
			const getResults = vi.fn(() => mockResults)
			const trigger = createFileTrigger({ onSearch, getResults })

			const result = trigger.search("test")

			expect(onSearch).toHaveBeenCalledWith("test")
			expect(getResults).toHaveBeenCalled()
			expect(result).toBe(mockResults)
		})
	})
})
