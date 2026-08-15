// Requires magick

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { minify as minifyHTML } from "html-minifier-next";
import { dirname } from "node:path";

const execFile = promisify(execFileCallback);

const outputDirectory = "dist";
const sourceDirectory = "src";
const sourceIcon = `${sourceDirectory}/icon.png`;

const icons = [
  ["apple-touch-icon.png", 180],
  ["favicon.ico", 16],
  ["icon_32.png", 32],
  ["icon_maskable_192.png", 192],
  ["icon_shadow_192.png", 192],
  ["icon_windows_150.png", 270],
];

const template = readFile(`${sourceDirectory}/index.html`, "utf8");

const distReady = rm(outputDirectory, { recursive: true, force: true }).then(
  () => mkdir(outputDirectory, { recursive: true }),
);
const deploy = distReady.then(() =>
  execFile("rsync", [
    "-a",
    "--exclude=*.html",
    "--exclude=*.css",
    "--exclude=*.ts",
    "--exclude=icon.png",
    `${sourceDirectory}/`,
    `${outputDirectory}/`,
  ]),
);

const bundleOptions = {
  bundle: true,
  legalComments: "none",
  minify: true,
  platform: "browser",
  target: "es2024",
  write: false,
};

async function bundle(entryPoint, outputPath, minify = true, format = "iife") {
  const result = await build({
    ...bundleOptions,
    entryPoints: [entryPoint],
    minify,
    format,
    ...(format === "iife" ? { globalName: "app" } : { globalName: undefined }),
  });
  if (outputPath != null) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.outputFiles[0].text, "utf8");
  }
  return result.outputFiles[0].text;
}

async function bundleCss(entryPoint) {
  const result = await build({
    bundle: true,
    entryPoints: [entryPoint],
    legalComments: "none",
    minify: false,
    write: false,
  });
  return result.outputFiles[0].text;
}

async function generateIcon(fileName, size) {
  await execFile("magick", [
    sourceIcon,
    "-resize",
    `${size}x${size}!`,
    `${outputDirectory}/${fileName}`,
  ]);
}

await deploy;

const [editor, editorStyle] = await Promise.all([
  bundle(`${sourceDirectory}/index.ts`, null),
  bundleCss(`${sourceDirectory}/style.css`),
  bundle(
    "synth/audio-worklet.ts",
    `${outputDirectory}/synth_worklet.js`,
    true,
    "esm",
  ),
  bundle(
    `${sourceDirectory}/service_worker.ts`,
    `${outputDirectory}/service_worker.js`,
  ),
  ...icons.map(([fileName, size]) => generateIcon(fileName, size)),
]);

const inlineEditorStyle = `<style>${editorStyle.replace(/<\/style/gi, "<\\/style")}</style>`;
const html = await minifyHTML(
  (await template)
    .replace("<!-- INLINE_EDITOR_STYLE -->", () => inlineEditorStyle)
    .replace("<!-- INLINE_EDITOR_SCRIPT -->", () => editor),
  {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    minifyCSS: true,
    minifyJS: true,
    removeAttributeQuotes: true,
    removeComments: true,
    removeRedundantAttributes: true,
    useShortDoctype: true,
  },
);
await distReady;
await writeFile(`${outputDirectory}/index.html`, html, "utf8");
await deploy;
