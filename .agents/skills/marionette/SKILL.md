---
name: marionette
description: "Use headless Firefox/LibreWolf Marionette to drive a local web app, exercise UI interactions, and capture screenshots. Apply when browser verification needs exact protocol-level control or visual evidence."
---

# Headless Marionette workflow

Use a disposable browser profile and a small Node TCP client. Keep the app server, browser, and client separate so failures are diagnosable.

## 1. Start the app

From the project directory, start the project server (for goopbox, `npm start`) and record its URL. Wait until the URL responds before launching the browser.

## 2. Launch browser

Use a unique profile; a normal profile may already be locked by a running browser.

This command uses Flatpak LibreWolf, which GoopBox is tested against.

```sh
profile_dir="$(mktemp -d /tmp/marionette-profile.XXXXXX)"
flatpak run io.gitlab.librewolf-community \
  --profile "$profile_dir" --headless --marionette about:blank
ss -ltn | rg ':2828\\b'
```

Port 2828 is Marionette's default. A user-namespace warning from Flatpak is usually harmless; the `ss` check is authoritative.

## 3. Speak the Marionette protocol

Connect to `127.0.0.1:2828` over TCP. Marionette packets are length-prefixed JSON: `<byteLength>:<json>`. The greeting is an object; commands are `[0, id, "Method", params]`; responses are `[1, id, error, result]`. Buffer reads because one read can contain partial or multiple packets. Use monotonically increasing command IDs and reject a response whose ID does not match.

The minimum command sequence is:

1. `WebDriver:NewSession` with `{capabilities:{}}`.
2. `WebDriver:SetWindowRect` with a deterministic width and height.
3. `WebDriver:Navigate` with `{url:"http://..."}`.
4. `WebDriver:ExecuteScript` to wait for app readiness or inspect state.
5. `WebDriver:TakeScreenshot` with `{id:null,full:false,highlights:[]}`.
6. `Marionette:Quit` with `{flags:["eForceQuit"]}`.

## 4. Execute page JavaScript safely

Use `WebDriver:ExecuteScript` params `{script,args,newSandbox:false,sandbox:"default"}`. Firefox's Xray wrapper can hide page globals and methods. When the application exposes a lexical global such as `editor`, retrieve it through the page window:

```js
const pageWindow = window.wrappedJSObject ?? window;
const app = pageWindow.eval("editor");
```

Prefer DOM queries for normal tests. Access runtime-private TypeScript fields only for diagnostics; TypeScript `private` is not private at runtime. After any interaction, wait for the app's render/update tick (typically 100–250 ms) before reading state or taking a screenshot.

## 5. Reproduce pointer interactions

Inspect `getBoundingClientRect()` and calculate coordinates from the actual element, never guessed viewport coordinates. Dispatch bubbling, composed `PointerEvent`s with stable `pointerId`, `pointerType:"mouse"`, `isPrimary:true`, button/buttons, modifier keys, and `clientX/clientY`.

Synthetic pointers are untrusted and may make pointer capture throw. In the page script, temporarily install no-op `setPointerCapture`, `releasePointerCapture`, and `hasPointerCapture` methods on the target element before dispatching events. Restore them afterward when the page's own handlers require the native methods.

For a drag, dispatch `pointerdown`, several `pointermove`s, then `pointerup`; preserve the same pointer ID and set `buttons:1` during movement. Include `shiftKey`/`ctrlKey`/`metaKey` exactly as the UI requires. Capture a screenshot after the final render tick.

## 6. Save and inspect the screenshot

The screenshot result is base64 in `result.value`. Decode it with Node, preferably to `/tmp`:

```js
writeFileSync("/tmp/marionette-shot.png", Buffer.from(result.value, "base64"));
```

Use the image viewer tool to inspect the file. Keep screenshots as evidence; do not commit them unless explicitly requested.

## 7. Always clean up

Send `Marionette:Quit` in a `finally` block, close the TCP socket, stop the app server and browser process, and remove only the uniquely-created temporary profile directory. Re-check `ss -ltn | rg ':2828\\b'` so stale browsers do not affect the next run.

## Troubleshooting

- Browser says it is already running or not responding: launch with a fresh `--profile` directory.
- `editor is not defined`: evaluate through `window.wrappedJSObject.eval("editor")`.
- A method is missing (`getChannelCount is not a function`): the value is likely an Xray wrapper; use `wrappedJSObject` or plain properties such as `song.channels.length`.
- `setPointerCapture` fails: install the temporary no-op pointer-capture methods described above.
- No screenshot or a truncated image: ensure the response parser handles framed packets and decode `result.value`, not the entire response object.
- Port 2828 is occupied: identify the process before stopping it; never kill unrelated browsers.

# Minimal Marionette client

```js
import net from "node:net";
import { writeFileSync } from "node:fs";

const socket = net.createConnection({ host: "127.0.0.1", port: 2828 });
let buffer = Buffer.alloc(0);
let nextId = 0;
const pending = new Map();

function packet(value) {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`${body.length}:`), body]);
}
function send(method, params = {}) {
  const id = ++nextId;
  socket.write(packet([0, id, method, params]));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function drain() {
  while (true) {
    const colon = buffer.indexOf(58);
    if (colon < 0) return;
    const length = Number(buffer.subarray(0, colon).toString());
    if (!Number.isInteger(length) || buffer.length < colon + 1 + length) return;
    const value = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length));
    buffer = buffer.subarray(colon + 1 + length);
    if (Array.isArray(value) && value[0] === 1) {
      const waiter = pending.get(value[1]);
      pending.delete(value[1]);
      if (value[2]) waiter.reject(value[2]);
      else waiter.resolve(value[3]);
    }
  }
}
socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});

await new Promise((resolve) => socket.once("connect", resolve));
await send("WebDriver:NewSession", { capabilities: {} });
await send("WebDriver:SetWindowRect", { width: 1280, height: 900 });
await send("WebDriver:Navigate", { url: process.argv[2] });
await new Promise((r) => setTimeout(r, 500));
const result = await send("WebDriver:TakeScreenshot", {
  id: null,
  full: false,
  highlights: [],
});
writeFileSync(
  process.argv[3] ?? "/tmp/marionette-shot.png",
  Buffer.from(result.value, "base64"),
);
await send("Marionette:Quit", { flags: ["eForceQuit"] }).catch(() => {});
socket.end();
```
