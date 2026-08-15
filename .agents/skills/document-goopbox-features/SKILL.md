---
name: document-goopbox-features
description: Maintain the concise feature-title grid in the goopbox tab of src/AboutPrompt.ts after the user explicitly asks to document a completed feature from the current turn. Use for major, user-important, visible goopbox features and major user-facing reworks. Do not use while implementing a feature or for implementation details, technical or internal reworks, minor fixes, or changes that do not materially affect the user experience.
---

# Document goopbox features

Update only the `goopbox` tab's feature-title grid in `src/AboutPrompt.ts`.

- Inspect only the completed feature from the current turn.
- Add a short, surface-level title without instructions or a description.
- Treat a major rework of an existing feature as feature-worthy.
- Combine changes in the same feature area into one title.
- Keep an existing title unchanged when it already covers the change, unless
  the combined scope meaningfully changes what the title must convey.
- Leave the grid unchanged when the feature does not merit a title.
