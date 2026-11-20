# `files/` — production notes and script artifacts

Non-code deliverables live here.

| File | Purpose |
|---|---|
| `VIDEO_SCRIPT.md` | Professional 10–12 minute demo script: page-by-page narration, click sequence, chapter markers, Vercel env checklist, and recording pitfalls. |

Earlier versions of the project kept a `files/brain/` mirror of the source registry here. That mirror is no longer part of the current layout: the runtime registry is `frontend/data/sources_registry.json`, and the planning docs live in `brain/brain/`. If you need a mirror again, copy the runtime file and verify hashes before relying on it.

## Rules for this folder

- No real API keys, tokens, or database passwords.
- Screenshots and recordings must show masked vault values only.
- When you change a page flow or an env var, update `VIDEO_SCRIPT.md` in the same change so the walkthrough stays truthful.
