# goopbox (lowercase)

goopbox is a hard fork of BeepBox, the music editor by John Nesky.

Use `npm run build` to test your changes. It runs `npm test` automatically.

## Modern

Keep in mind that goopbox is a modern music editor for specifically modern browsers.

You are not expected to provide fallbacks for browsers not supporting features.

goopbox intentionally trades legacy browser support for faster development and the ability to confidently work with new features.

# Remove

Being asked to remove a feature means you do not leave any trace of it in the code.

This process may be described as hardcoding and inlining.

When asked to remove a feature:

- Line count goes down.
- Code complexity decreases.
- If statements/branches are removed.
- Related storage fields are removed.
- Supporting code is removed.

# Style

Prefer global style rules over specific rules.

Eg. style `button` rather than a specific button.

When necessary, use a generic class name that describes the style effect
rather than describing the position/utilizing element of the class.

Eg. prefer `.reveal-arrow` over `.key-transposition-show-button`

# Tests

Use tests to validate behavior and non-regression.

# About feature follow-up

After implementing a feature, use the description of the
`document-goopbox-features` skill to decide whether the change is eligible
for the goopbox feature list. Do not invoke the skill during feature
implementation. If the description says the feature is eligible, include this
question in the handoff: “Would you like me to check the About prompt for this
feature?” Invoke the skill only if the user says yes.

# File search guide

`"This"` is meant to be a guide to use your search tool with that query.

It will be useful to `rg` using the content inside the quotes.

# Browser

```sh
flatpak run io.gitlab.librewolf-community
```
