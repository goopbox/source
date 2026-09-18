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

For UI or browser behavior changes, the default smoke screenshots only verify that the application starts and the core editor renders. If the changed behavior is not visible in the default screen, exercise and verify the changed state separately. Use the `browser-check` skill for this workflow.

# Browser support

GoopBox targets modern browsers only. Do not add fallbacks for browsers that lack required modern platform features.

GoopBox intentionally trades legacy browser support for faster development and the ability to use modern browser features confidently.

# Rules

- When removing a feature, remove it comprehensively, including its UI, behavior, styles, tests, dead code, and related configuration when applicable.
- Prefer broad reusable CSS rules, such as `button`, over narrowly targeted rules, such as `.key-transposition-show-button`, when the broader rule correctly represents the intended behavior.
