# GoopBox

GoopBox is a hard fork of BeepBox, the music editor by John Nesky.

# Environment

- Node 26
- If required, playwright browsers:
  `npx playwright install chromium firefox`

# Development workflow

1. Run the smallest relevant test during development when it provides a faster feedback loop.
2. Add or update regression tests for behavior changes and bug fixes.
3. Run `npm run fix`.
4. Run `npm run build`.
5. Visually verify:`.artifacts/smoke-chromium.png` and `.artifacts/smoke-firefox.png`

To report success, every check of `npm run build` must pass.

Do not weaken testing to make verification pass.

If missing browser binaries or host dependencies prevent browser verification, report that explicitly. Do not claim the build passed.

`npm run build` creates `.artifacts/smoke-chromium.png` and `.artifacts/smoke-firefox.png`; visually inspect both. These smoke tests only verify startup and core rendering, so if the changed behavior is not visible on startup, use Playwright against `http://127.0.0.1:8080` to exercise the exact changed state and verify its behavior, rendered result, page errors, and failed same-origin requests, capturing screenshots when useful.

# Browser support

GoopBox targets modern browsers only. Do not add fallbacks for browsers that lack required modern platform features.

GoopBox intentionally trades legacy browser support for faster development and the ability to use modern browser features confidently.

# Rules

- When removing a feature, remove it comprehensively, including its UI, behavior, styles, tests, dead code, and related configuration when applicable.
- Prefer broad reusable CSS rules, such as `button`, over narrowly targeted rules, such as `.key-transposition-show-button`, when the broader rule correctly represents the intended behavior.
- Maintain attribution in `LICENSE/LICENSE.md`, and `src/about-prompt.ts` synchronized with current dependencies, bundled assets, or copied source projects.
