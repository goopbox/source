import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const root = resolve("dist");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

createServer((request, response) => {
  const urlPath = decodeURIComponent(request.url?.split(/[?#]/)[0] ?? "/");
  const requestedPath = resolve(root, "." + urlPath);

  if (requestedPath !== root && !requestedPath.startsWith(root + "/")) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let fileToSend = requestedPath;
  if (urlPath === "/") {
    fileToSend = resolve(root, "index.html");
  } else if (
    existsSync(requestedPath) &&
    statSync(requestedPath).isDirectory()
  ) {
    if (!urlPath.endsWith("/")) {
      response.writeHead(301, { Location: urlPath + "/" }).end();
      return;
    }
    fileToSend = resolve(requestedPath, "index.html");
  } else if (!existsSync(fileToSend) || !statSync(fileToSend).isFile()) {
    response
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type":
      contentTypes[extname(fileToSend)] ?? "application/octet-stream",
  });
  createReadStream(fileToSend).pipe(response);
}).listen(8080, () => {
  console.log("Running at http://localhost:8080");
});
