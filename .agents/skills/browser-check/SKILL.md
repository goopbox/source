---
name: browser-check
description: "Verify UI and browser behavior after changes. Use for rendered UI, browser events, startup, static assets, service workers, browser APIs, or any change whose correctness is not fully proven by Node tests."
---

# Browser verification

`npm run build` already runs the repository's Chromium and Firefox Playwright smoke test and saves `.artifacts/smoke-chromium.png` and `.artifacts/smoke-firefox.png`. Inspect both images after the build.

The default smoke test is a boot/render contract, not proof of every interaction. When a change affects a state not visible on startup, exercise that exact state before handoff.

Prefer Playwright for normal browser verification. Reuse the configured browsers and `http://127.0.0.1:8080`. Check the changed behavior, page errors, failed same-origin requests, and the resulting rendered state. Capture a screenshot when visual state matters. Temporary exploratory scripts and screenshots belong under `.artifacts/` and must not be committed.

If a behavior is important enough to regress, add a stable automated assertion to the appropriate test. Keep the permanent smoke test focused on high-value application-wide boot/render guarantees rather than accumulating feature-specific scenarios.
