import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback),
  sourceIcon = "scripts/assets/icon.png",
  outputDirectory = "src",
  icons = [
    ["apple-touch-icon.png", 180],
    ["favicon.ico", 16],
    ["icon_32.png", 32],
    ["icon_maskable_192.png", 192],
    ["icon_shadow_192.png", 192],
    ["icon_windows_150.png", 270],
  ];

await Promise.all(
  icons.map(([fileName, size]) =>
    execFile("magick", [
      sourceIcon,
      "-sample",
      `${size}x${size}!`,
      "-strip",
      `${outputDirectory}/${fileName}`,
    ]),
  ),
);
