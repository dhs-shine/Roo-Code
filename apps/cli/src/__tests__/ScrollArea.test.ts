/**
 * Unit tests for ScrollArea component reducer logic
 */

// Since we can't easily test React components without a proper Ink test setup,
// we'll test the reducer logic that powers the ScrollArea behavior.

interface ScrollAreaState {
	innerHeight: number
	height: number
	scrollTop: number
	autoScroll: boolean
}

/**
 * Calculate scrollbar handle position and size
 */
function calculateScrollbar(
	viewportHeight: number,
	contentHeight: number,
	scrollTop: number,
): { handleStart: number; handleHeight: number; maxScroll: number } {
	const maxScroll = Math.max(0, contentHeight - viewportHeight)

	if (contentHeight <= viewportHeight || maxScroll === 0) {
		// No scrolling needed - handle fills entire track
		return { handleStart: 0, handleHeight: viewportHeight, maxScroll: 0 }
	}

	// Calculate handle height as ratio of viewport to content (minimum 1 line)
	const handleHeight = Math.max(1, Math.round((viewportHeight / contentHeight) * viewportHeight))

	// Calculate handle position
	const trackSpace = viewportHeight - handleHeight
	const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0
	const handleStart = Math.round(scrollRatio * trackSpace)

	return { handleStart, handleHeight, maxScroll }
}

type ScrollAreaAction =
	| { type: "SET_INNER_HEIGHT"; innerHeight: number }
	| { type: "SET_HEIGHT"; height: number }
	| { type: "SCROLL_DOWN"; amount?: number }
	| { type: "SCROLL_UP"; amount?: number }
	| { type: "SCROLL_TO_BOTTOM" }
	| { type: "SET_AUTO_SCROLL"; autoScroll: boolean }

// Copy of the reducer from ScrollArea.tsx for testing
function reducer(state: ScrollAreaState, action: ScrollAreaAction): ScrollAreaState {
	const maxScroll = Math.max(0, state.innerHeight - state.height)

	switch (action.type) {
		case "SET_INNER_HEIGHT": {
			const newMaxScroll = Math.max(0, action.innerHeight - state.height)
			if (state.autoScroll && action.innerHeight > state.innerHeight) {
				return {
					...state,
					innerHeight: action.innerHeight,
					scrollTop: newMaxScroll,
				}
			}
			return {
				...state,
				innerHeight: action.innerHeight,
				scrollTop: Math.min(state.scrollTop, newMaxScroll),
			}
		}

		case "SET_HEIGHT": {
			const newMaxScroll = Math.max(0, state.innerHeight - action.height)
			if (state.autoScroll) {
				return {
					...state,
					height: action.height,
					scrollTop: newMaxScroll,
				}
			}
			return {
				...state,
				height: action.height,
				scrollTop: Math.min(state.scrollTop, newMaxScroll),
			}
		}

		case "SCROLL_DOWN": {
			const amount = action.amount || 1
			const newScrollTop = Math.min(maxScroll, state.scrollTop + amount)
			const atBottom = newScrollTop >= maxScroll
			return {
				...state,
				scrollTop: newScrollTop,
				autoScroll: atBottom,
			}
		}

		case "SCROLL_UP": {
			const amount = action.amount || 1
			const newScrollTop = Math.max(0, state.scrollTop - amount)
			return {
				...state,
				scrollTop: newScrollTop,
				autoScroll: newScrollTop >= maxScroll,
			}
		}

		case "SCROLL_TO_BOTTOM":
			return {
				...state,
				scrollTop: maxScroll,
				autoScroll: true,
			}

		case "SET_AUTO_SCROLL":
			return {
				...state,
				autoScroll: action.autoScroll,
				scrollTop: action.autoScroll ? maxScroll : state.scrollTop,
			}

		default:
			return state
	}
}

describe("ScrollArea reducer", () => {
	const initialState: ScrollAreaState = {
		innerHeight: 0,
		height: 10,
		scrollTop: 0,
		autoScroll: true,
	}

	describe("SET_INNER_HEIGHT", () => {
		it("should update inner height", () => {
			const state = reducer(initialState, { type: "SET_INNER_HEIGHT", innerHeight: 20 })
			expect(state.innerHeight).toBe(20)
		})

		it("should auto-scroll to bottom when content grows and autoScroll is enabled", () => {
			const state: ScrollAreaState = {
				...initialState,
				innerHeight: 15,
				autoScroll: true,
			}
			const newState = reducer(state, { type: "SET_INNER_HEIGHT", innerHeight: 25 })
			expect(newState.innerHeight).toBe(25)
			// maxScroll = 25 - 10 = 15
			expect(newState.scrollTop).toBe(15)
		})

		it("should NOT auto-scroll when autoScroll is disabled", () => {
			const state: ScrollAreaState = {
				...initialState,
				innerHeight: 15,
				scrollTop: 3,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SET_INNER_HEIGHT", innerHeight: 25 })
			expect(newState.innerHeight).toBe(25)
			expect(newState.scrollTop).toBe(3) // Unchanged
		})

		it("should clamp scrollTop when content shrinks", () => {
			const state: ScrollAreaState = {
				...initialState,
				innerHeight: 30,
				scrollTop: 15,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SET_INNER_HEIGHT", innerHeight: 15 })
			// maxScroll = 15 - 10 = 5, scrollTop was 15 which is > 5
			expect(newState.scrollTop).toBe(5)
		})
	})

	describe("SET_HEIGHT", () => {
		it("should update viewport height", () => {
			const state: ScrollAreaState = {
				...initialState,
				innerHeight: 20,
			}
			const newState = reducer(state, { type: "SET_HEIGHT", height: 15 })
			expect(newState.height).toBe(15)
		})

		it("should scroll to bottom when autoScroll is enabled and viewport changes", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 20, // at bottom
				autoScroll: true,
			}
			const newState = reducer(state, { type: "SET_HEIGHT", height: 15 })
			// maxScroll = 30 - 15 = 15
			expect(newState.scrollTop).toBe(15)
		})

		it("should clamp scrollTop when viewport grows", () => {
			const state: ScrollAreaState = {
				innerHeight: 20,
				height: 10,
				scrollTop: 10, // maxScroll was 10
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SET_HEIGHT", height: 15 })
			// maxScroll = 20 - 15 = 5
			expect(newState.scrollTop).toBe(5)
		})
	})

	describe("SCROLL_DOWN", () => {
		it("should scroll down by 1 by default", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 5,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SCROLL_DOWN" })
			expect(newState.scrollTop).toBe(6)
		})

		it("should scroll down by specified amount", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 5,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SCROLL_DOWN", amount: 5 })
			expect(newState.scrollTop).toBe(10)
		})

		it("should not scroll past maxScroll", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 18,
				autoScroll: false,
			}
			// maxScroll = 30 - 10 = 20
			const newState = reducer(state, { type: "SCROLL_DOWN", amount: 10 })
			expect(newState.scrollTop).toBe(20)
		})

		it("should re-enable autoScroll when reaching bottom", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 19,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SCROLL_DOWN" })
			expect(newState.scrollTop).toBe(20)
			expect(newState.autoScroll).toBe(true)
		})
	})

	describe("SCROLL_UP", () => {
		it("should scroll up by 1 by default", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 10,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SCROLL_UP" })
			expect(newState.scrollTop).toBe(9)
		})

		it("should scroll up by specified amount", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 10,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SCROLL_UP", amount: 5 })
			expect(newState.scrollTop).toBe(5)
		})

		it("should not scroll past 0", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 3,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SCROLL_UP", amount: 10 })
			expect(newState.scrollTop).toBe(0)
		})

		it("should disable autoScroll when scrolling up from bottom", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 20, // at bottom
				autoScroll: true,
			}
			const newState = reducer(state, { type: "SCROLL_UP" })
			expect(newState.scrollTop).toBe(19)
			expect(newState.autoScroll).toBe(false)
		})
	})

	describe("SCROLL_TO_BOTTOM", () => {
		it("should scroll to bottom and enable autoScroll", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 5,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SCROLL_TO_BOTTOM" })
			expect(newState.scrollTop).toBe(20) // maxScroll
			expect(newState.autoScroll).toBe(true)
		})
	})

	describe("SET_AUTO_SCROLL", () => {
		it("should enable autoScroll and scroll to bottom", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 5,
				autoScroll: false,
			}
			const newState = reducer(state, { type: "SET_AUTO_SCROLL", autoScroll: true })
			expect(newState.autoScroll).toBe(true)
			expect(newState.scrollTop).toBe(20) // scrolled to bottom
		})

		it("should disable autoScroll without changing scrollTop", () => {
			const state: ScrollAreaState = {
				innerHeight: 30,
				height: 10,
				scrollTop: 20,
				autoScroll: true,
			}
			const newState = reducer(state, { type: "SET_AUTO_SCROLL", autoScroll: false })
			expect(newState.autoScroll).toBe(false)
			expect(newState.scrollTop).toBe(20)
		})
	})

	describe("edge cases", () => {
		it("should handle content smaller than viewport", () => {
			const state: ScrollAreaState = {
				innerHeight: 5, // smaller than viewport
				height: 10,
				scrollTop: 0,
				autoScroll: true,
			}
			const downState = reducer(state, { type: "SCROLL_DOWN" })
			expect(downState.scrollTop).toBe(0) // maxScroll is 0

			const bottomState = reducer(state, { type: "SCROLL_TO_BOTTOM" })
			expect(bottomState.scrollTop).toBe(0)
		})

		it("should handle empty content", () => {
			const state: ScrollAreaState = {
				innerHeight: 0,
				height: 10,
				scrollTop: 0,
				autoScroll: true,
			}
			const newState = reducer(state, { type: "SCROLL_DOWN" })
			expect(newState.scrollTop).toBe(0)
		})
	})
})

describe("calculateScrollbar", () => {
	it("should return full height handle when content fits in viewport", () => {
		const result = calculateScrollbar(10, 5, 0)
		expect(result.handleHeight).toBe(10)
		expect(result.handleStart).toBe(0)
		expect(result.maxScroll).toBe(0)
	})

	it("should return full height handle when content equals viewport", () => {
		const result = calculateScrollbar(10, 10, 0)
		expect(result.handleHeight).toBe(10)
		expect(result.handleStart).toBe(0)
		expect(result.maxScroll).toBe(0)
	})

	it("should calculate handle height proportional to content ratio", () => {
		// Viewport is half of content, handle should be ~half of viewport
		const result = calculateScrollbar(10, 20, 0)
		expect(result.handleHeight).toBe(5) // 10 / 20 * 10 = 5
		expect(result.maxScroll).toBe(10)
	})

	it("should position handle at top when scrollTop is 0", () => {
		const result = calculateScrollbar(10, 20, 0)
		expect(result.handleStart).toBe(0)
	})

	it("should position handle at bottom when scrolled to max", () => {
		// Viewport 10, content 20, maxScroll = 10
		// Handle height = 5, track space = 10 - 5 = 5
		// At max scroll, handle should be at position 5
		const result = calculateScrollbar(10, 20, 10)
		expect(result.handleStart).toBe(5)
	})

	it("should position handle in middle when scrolled halfway", () => {
		// Viewport 10, content 20, maxScroll = 10
		// Handle height = 5, track space = 5
		// At scroll 5 (50%), handle should be at position 2-3
		const result = calculateScrollbar(10, 20, 5)
		expect(result.handleStart).toBe(3) // Math.round(0.5 * 5) = 3
	})

	it("should enforce minimum handle height of 1", () => {
		// Very large content relative to viewport
		const result = calculateScrollbar(10, 1000, 0)
		expect(result.handleHeight).toBe(1) // Math.max(1, Math.round(10/1000 * 10)) = 1
	})

	it("should handle small viewports", () => {
		const result = calculateScrollbar(3, 10, 0)
		expect(result.handleHeight).toBe(1) // Math.round(3/10 * 3) = 1
		expect(result.maxScroll).toBe(7)
	})

	it("should handle edge case where scrollTop exceeds maxScroll", () => {
		// This shouldn't happen in practice, but test for robustness
		const result = calculateScrollbar(10, 20, 15) // maxScroll is 10
		// scrollRatio = 15/10 = 1.5, but handleStart should be clamped by trackSpace
		expect(result.handleStart).toBe(8) // Math.round(1.5 * 5) = 8 (will be past track but shows calculation)
	})
})

/**
 * Helper function that mirrors the scrollbar visibility logic from ScrollArea.tsx
 * This is used to test the visibility behavior without needing to render the component.
 */
function shouldShowScrollbar(showScrollbar: boolean, maxScroll: number, isActive: boolean): boolean {
	// Show scrollbar when: there's content to scroll, OR when focused (to indicate focus state)
	// Hide scrollbar only when: not focused AND nothing to scroll
	return showScrollbar && (maxScroll > 0 || isActive)
}

describe("scrollbar visibility", () => {
	it("should show scrollbar when there is content to scroll (regardless of focus)", () => {
		// When maxScroll > 0, scrollbar should show regardless of isActive
		expect(shouldShowScrollbar(true, 10, true)).toBe(true)
		expect(shouldShowScrollbar(true, 10, false)).toBe(true)
	})

	it("should show scrollbar when focused, even if nothing to scroll", () => {
		// When isActive is true but maxScroll is 0, scrollbar should show for focus indication
		expect(shouldShowScrollbar(true, 0, true)).toBe(true)
	})

	it("should hide scrollbar when not focused and nothing to scroll", () => {
		// Only hide when both: not focused AND nothing to scroll
		expect(shouldShowScrollbar(true, 0, false)).toBe(false)
	})

	it("should respect showScrollbar prop", () => {
		// When showScrollbar is false, never show scrollbar
		expect(shouldShowScrollbar(false, 10, true)).toBe(false)
		expect(shouldShowScrollbar(false, 0, true)).toBe(false)
		expect(shouldShowScrollbar(false, 10, false)).toBe(false)
		expect(shouldShowScrollbar(false, 0, false)).toBe(false)
	})
})
