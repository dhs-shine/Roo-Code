# Changelog

All notable changes to the `@roo-code/cli` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
