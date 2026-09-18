import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

import { build } from "esbuild";
import { minify as minifyHTML } from "html-minifier-next";

const outputDirectory = "dist",
  sourceDirectory = "src",
  ignoredSourceExtensions = new Set([".css", ".html", ".ts"]),
  bundleOptions = {
    bundle: true,
    legalComments: "none",
    minify: true,
    platform: "browser",
    target: "es2024",
    write: false,
  };

async function prepareDist() {
  await rm(outputDirectory, { recursive: true, force: true });
  await cp(sourceDirectory, outputDirectory, {
    recursive: true,
    filter: (source) => !ignoredSourceExtensions.has(extname(source)),
  });
}

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

await prepareDist();

const [template, editor, editorStyle] = await Promise.all([
    readFile(`${sourceDirectory}/index.html`, "utf8"),
    bundle(`${sourceDirectory}/index.ts`, null),
    bundleCss(`${sourceDirectory}/style.css`),
    bundle("synth/audio-worklet.ts", `${outputDirectory}/synth_worklet.js`, true, "esm"),
    bundle(`${sourceDirectory}/service-worker.ts`, `${outputDirectory}/service-worker.js`),
  ]),
  inlineEditorStyle = `<style>${editorStyle.replaceAll(
    /<\/style/gi,
    String.raw`<\/style`,
  )}</style>`,
  html = await minifyHTML(
    template
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
await writeFile(`${outputDirectory}/index.html`, html, "utf8");
