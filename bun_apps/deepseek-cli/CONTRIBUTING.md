# Contributing

## Development

```bash
# Install dependencies
bun install

# Run the CLI during development
bun src/index.ts --model flash "test prompt"

# Build the standalone bundle
bun run build
```

## Guidelines

- Keep the CLI minimal and focused on its single purpose: calling DeepSeek models.
- Model mappings are maintained in the `MODELS` record in `src/index.ts`.
- When adding a new model alias, update both `src/index.ts` and the model table in `README.md`.
- The `.ts` file is the canonical implementation; any `.sh` or `.ps1` wrappers elsewhere in the repository should be updated in lockstep.

## Code style

There is no linter or formatter configured for this package. Please keep changes consistent with the existing style:
- Straightforward, imperative code with minimal abstraction
- Inline comments using `//` for section headers
- Descriptive variable names over deep comment blocks
