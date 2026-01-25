# Workflow Rules

## Verification & Build
Always run the following commands at the end of each request to ensure code stability and quality:
- Format and Lint: `bun run format`
- Typecheck: `bun run typecheck`
- Test: `bun run test`
- Build: `bun run build`

Do not hand back control to the user until these checks pass. Fix any errors introduced by your changes.
