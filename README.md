# Lens — VS Code Extension

**Lightweight code quality & security scanner** — right in your editor.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Extension-blue)](https://marketplace.visualstudio.com/items?itemName=fatmuh.lens)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Lens scans your code for issues, bugs, security vulnerabilities, and code smells — powered by [Lens CLI](https://github.com/fatmuh/lens).

## Features

- 🔍 **Real-time scanning** — issues appear as squiggly lines in your editor
- 📊 **5 languages** — TypeScript/JS, Python, Go, Rust, Dart
- 🛡️ **618 rules** — including security taint analysis
- ⚡ **Instant** — scans single files in <100ms
- 🤖 **AI fix** — fix issues with one click (BYOK)
- 🔧 **Configurable** — severity mapping, scan triggers, custom rules

## Install

1. Install [Lens CLI](https://github.com/fatmuh/lens):
   ```bash
   # macOS / Linux
   curl -fsSL https://raw.githubusercontent.com/fatmuh/lens/main/install.sh | sh

   # Windows (PowerShell)
   iwr -useb https://raw.githubusercontent.com/fatmuh/lens/main/install.ps1 | iex
   ```

2. Install this extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fatmuh.lens)

3. Open a project and run **Lens: Scan Workspace** from the command palette

## Usage

| Command | Description |
|---------|-------------|
| `Lens: Scan Workspace` | Scan the entire workspace |
| `Lens: Scan Current File` | Scan just the active file |
| `Lens: Clear Results` | Clear all diagnostics |
| `Lens: Show Output` | Open the Lens output panel |
| `Lens: AI Fix Current File` | Run AI-powered auto-fix on current file |

### Auto-scan

By default, Lens scans files on save. Configure in settings:

```json
{
  "lens.scanOnSave": true,
  "lens.scanOnOpen": false
}
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `lens.path` | `"lens"` | Path to the `lens` binary |
| `lens.scanOnSave` | `true` | Scan on file save |
| `lens.scanOnOpen` | `false` | Scan when file opens |
| `lens.maxProblems` | `200` | Max problems per file |
| `lens.configPath` | `""` | Path to `quality-gate.toml` |
| `lens.severity` | (see below) | Map Lens severity to VS Code |

### Severity mapping

```json
{
  "lens.severity": {
    "blocker": "error",
    "critical": "error",
    "major": "warning",
    "minor": "information",
    "info": "hint"
  }
}
```

## Supported Languages

| Language | File Extensions | Rules |
|----------|----------------|-------|
| TypeScript/JS | `.ts`, `.tsx`, `.js`, `.jsx` | 99 built-in + 493 SonarJS |
| Python | `.py`, `.pyi` | 8 |
| Go | `.go` | 6 |
| Rust | `.rs` | 6 |
| Dart/Flutter | `.dart` | 6 |

## Status Bar

The status bar shows:
- `✓ Lens: clean` — no issues
- `⚠ Lens: 5` — 5 issues found (with breakdown on hover)

Click to open the output panel with full details.

## Custom Rules

Custom rules defined in `quality-gate.toml` are automatically picked up:

```toml
[[rules.custom]]
id = "no-hardcoded-secrets"
name = "No hardcoded secrets"
severity = "blocker"
languages = ["typescript", "python"]
pattern = '''sk-[a-zA-Z0-9]{20,}'''
message = "Hardcoded secret detected"
```

## Links

- 📖 [Documentation](https://docs.lenscan.dev)
- 🐛 [Issues](https://github.com/fatmuh/lens-vscode/issues)
- 💻 [Lens CLI](https://github.com/fatmuh/lens)

## License

[MIT](LICENSE) © 2026 Fatmuh
