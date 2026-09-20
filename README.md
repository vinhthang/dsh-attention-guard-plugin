# dsh-plugin-attention-guard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Attention Guard plugin for DeepSeek Harness (`@deepseek-ai/cordis` and `@deepseek-ai/dsh-shell`).

## Overview

`dsh-plugin-attention-guard` decorates the `ctx.shell.resolve` seam in DeepSeek Harness to automatically filter and compress command outputs using the Rust Token Killer (`rtk`). This prevents context window bloat and Attention Dilution in LLM agent workflows.

## Features

- **Transparent Command Rewriting**: Automatically delegates supported commands (`pytest`, `cargo`, `git`, `npm`, etc.) to `rtk rewrite`.
- **Interactive & Streaming Bypass**: Automatically skips commands with interactive (`-it`, `-i`) or continuous streaming (`-f`, `--follow`, `--watch`, `-w`) flags.
- **Fail-Open Resilience**: If `rtk` is missing or fails, commands seamlessly execute unmodified without interrupting agent loops.
- **Cordis v4 Native**: Implemented as a declarative Cordis plugin injecting `shell` and validating configuration via `@deepseek-ai/schemastery`.

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable or disable attention guard rewriting |
| `model` | `string` | `'deepseek-flash'` | Model identifier for harness operations |
| `rtkBinary` | `string` | `'rtk'` | Binary name or absolute path to the `rtk` executable |
| `excludeCommands` | `string[]` | `[]` | List of command names or prefixes to exclude from rewriting |

### Usage Example

```typescript
import { Context } from '@deepseek-ai/cordis';
import AttentionGuardPlugin from 'dsh-plugin-attention-guard';

const ctx = new Context();

ctx.plugin(AttentionGuardPlugin, {
  enabled: true,
  model: 'deepseek-flash',
  rtkBinary: 'rtk',
  excludeCommands: ['git'],
});
```

## Development

```bash
# Install dependencies
pnpm install

# Run unit tests
pnpm test

# Typecheck
pnpm run typecheck

# Build to dist/
pnpm run build
```

## License

[MIT](LICENSE)
