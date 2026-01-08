# Changelog

All notable changes to the `@roo-code/cli` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.44] - 2026-01-08

### Added

- **Tool Renderer Components**: Specialized renderers for displaying tool outputs with optimized formatting for each tool type. Each renderer provides a focused view of its data structure.

    - [`FileReadTool`](src/ui/components/tools/FileReadTool.tsx) - Display file read operations with syntax highlighting
    - [`FileWriteTool`](src/ui/components/tools/FileWriteTool.tsx) - Show file write/edit operations with diff views
    - [`SearchTool`](src/ui/components/tools/SearchTool.tsx) - Render search results with context
    - [`CommandTool`](src/ui/components/tools/CommandTool.tsx) - Display command execution with output
    - [`BrowserTool`](src/ui/components/tools/BrowserTool.tsx) - Show browser automation actions
    - [`ModeTool`](src/ui/components/tools/ModeTool.tsx) - Display mode switching operations
    - [`CompletionTool`](src/ui/components/tools/CompletionTool.tsx) - Show task completion status
    - [`GenericTool`](src/ui/components/tools/GenericTool.tsx) - Fallback renderer for other tools

- **History Trigger**: New `#` trigger for task history autocomplete with fuzzy search support. Type `#` at the start of a line to browse and resume previous tasks.

    - [`HistoryTrigger.tsx`](src/ui/components/autocomplete/triggers/HistoryTrigger.tsx) - Trigger implementation with fuzzy filtering
    - Shows task status, mode, and relative timestamps
    - Supports keyboard navigation for quick task selection

- **Release Confirmation Prompt**: The release script now prompts for confirmation before creating a release.

### Fixed

- Task history picker selection and navigation issues
- Mode switcher keyboard handling bug

### Changed

- Reorganized test files into `__tests__` directories for better project structure
- Refactored utility modules into dedicated `utils/` directory

## [0.0.43] - 2026-01-07

### Added

- **Toast Notification System**: New toast notifications for user feedback with support for info, success, warning, and error types. Toasts auto-dismiss after a configurable duration and are managed via Zustand store.

    - New [`ToastDisplay`](src/ui/components/ToastDisplay.tsx) component for rendering toast messages
    - New [`useToast`](src/ui/hooks/useToast.ts) hook for managing toast state and displaying notifications

- **Global Input Sequences Registry**: Centralized system for handling keyboard shortcuts at the application level, preventing conflicts with input components.

    - New [`globalInputSequences.ts`](src/ui/utils/globalInputSequences.ts) utility module
    - Support for Kitty keyboard protocol (CSI u encoding) for better terminal compatibility
    - Built-in sequences for `Ctrl+C` (exit) and `Ctrl+M` (mode cycling)

- **Local Tarball Installation**: The install script now supports installing from a local tarball via the `ROO_LOCAL_TARBALL` environment variable, useful for offline installation or testing pre-release builds.

### Changed

- **MultilineTextInput**: Updated to respect global input sequences, preventing the component from consuming shortcuts meant for application-level handling.

### Tests

- Added comprehensive tests for the toast notification system
- Added tests for global input sequence matching

## [0.0.42] - 2025-01-07

The cli is alive!
