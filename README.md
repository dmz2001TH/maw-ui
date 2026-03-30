# maw-ui

ARRA Office frontend — the unified dashboard for Oracle fleet management.

## Modules

| Module | Description |
|--------|-------------|
| `src/` | React + Zustand app — fleet grid, mission control, terminal, dashboard, chat |
| `office-8bit` | Rust/WASM retro pixel UI (8-bit mode) |
| `shrine/` | Cloudflare Worker — static shrine page |
| `wasm-vm/` | Rust WASM VM — sandboxed code execution |
| `wasm-office/` | Rust WASM office runtime |
| `src/wasm-vm/` | WASM VM bindings (JS/TS glue) |

## Dev

```sh
bun install
bun run dev        # Vite dev server on :5173
bun run build      # Production build → dist/
```

## Deploy

```sh
bun run build
cp -r dist/* /path/to/maw-js/ui/office/
```

## Architecture

- **State**: Zustand stores — `feedStatusStore` (agent status), `previewStore` (terminal previews), `fleetStore` (UI prefs)
- **Data**: WebSocket feed from maw-js backend (:3456) — no HTTP polling
- **Views**: mission, office, fleet, dashboard, terminal, orbital, vs, config, chat, worktrees, teams
