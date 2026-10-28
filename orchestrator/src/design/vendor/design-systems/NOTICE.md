# Vendored design systems — provenance & attribution

These design-system presets are **vendored from the open-source project
[nexu-io/open-design](https://github.com/nexu-io/open-design)** (an open, local-first
Claude Design alternative), licensed under **Apache License 2.0**.

- Upstream repo: `nexu-io/open-design`
- Upstream commit: `36f57d5f9c44d39c869f3d6b30a55a279ab0c1ff`
- Upstream path: `design-systems/`
- License: Apache-2.0 (see `LICENSE` in this directory; copied verbatim from upstream)

## What was taken
For each of the 150 design systems we vendored **only** these files:

- `manifest.json` — system metadata (id / name / category / description / file map)
- `DESIGN.md` — canonical English design prose
- `DESIGN-zh.md` — Chinese design prose (present for 23 systems)
- `tokens.css` — canonical compiled CSS tokens (`:root` four-layer token block)
- `design-tokens.json` — DTCG token representation (consumed directly by 鲲鹏 color-engine)

Plus a generated `index.json` (鲲鹏-side catalog of all presets, schema
`kunpeng-design-presets/v1`).

## What was omitted (to keep the tree lean)
The other 17 locale `DESIGN-*.md`, `components.html` / `components.manifest.json`,
`tailwind-v4.css`, `preview/`, `source/`, and `USAGE.md` were **not** vendored.
Re-fetch from upstream at the pinned commit if needed.

## How 鲲鹏 uses them
Read at runtime from `orchestrator/src/design/vendor/design-systems/` (source tree,
like the vendored `frontend-design-skill.md`). The preset loader surfaces name/category/
seed color/DESIGN prose/DTCG tokens to the design loop — see `src/design/design-presets.ts`.

This is the same vendoring pattern 鲲鹏 already uses for the official Anthropic
`frontend-design` skill: verbatim upstream content, license + attribution preserved.
