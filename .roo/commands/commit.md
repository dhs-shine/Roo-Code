---
description: "Commit current changes with a descriptive message"
argument-hint: "[optional-context]"
mode: code
---

1. Analyze the current changes to understand what needs to be committed:

    ```bash
    # Check for staged and unstaged changes
    git status --short

    # View the diff of all changes (staged and unstaged)
    git diff HEAD
    ```

2. Based on the diff output, formulate a commit message following conventional commit format:

    - **feat**: New feature or functionality
    - **fix**: Bug fix
    - **refactor**: Code restructuring without behavior change
    - **docs**: Documentation changes
    - **test**: Adding or updating tests
    - **chore**: Maintenance tasks, dependencies, configs
    - **style**: Formatting, whitespace, no logic changes

    Format: `type(scope): brief description`

    Examples:

    - `feat(api): add user authentication endpoint`
    - `fix(ui): resolve button alignment on mobile`
    - `refactor(core): simplify error handling logic`
    - `docs(readme): update installation instructions`

3. Stage all unstaged changes:

    ```bash
    git add -A
    ```

4. Commit with the generated message:

    ```bash
    git commit -m "type(scope): brief description"
    ```

**Tips for good commit messages:**

- Keep the first line under 72 characters
- Use imperative mood ("add", "fix", "update", not "added", "fixes", "updated")
- Be specific but concise
- If multiple unrelated changes exist, consider splitting into separate commits
