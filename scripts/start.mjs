import { createReadStream, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { createServer } from "node:http";

const root = resolve("dist"),
  contentTypes = {
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
  const urlPath = decodeURIComponent(request.url?.split(/[?#]/)[0] ?? "/"),
    requestedPath = resolve(root, `.${urlPath}`);

  if (requestedPath !== root && !requestedPath.startsWith(`${root}/`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let fileToSend = requestedPath;
  if (urlPath === "/") {
    fileToSend = resolve(root, "index.html");
  } else {
    const stats = statSync(requestedPath, { throwIfNoEntry: false });
    if (stats?.isDirectory()) {
      if (!urlPath.endsWith("/")) {
        response.writeHead(301, { Location: `${urlPath}/` }).end();
        return;
      }
      fileToSend = resolve(requestedPath, "index.html");
    } else if (!stats?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(fileToSend)] ?? "application/octet-stream",
  });
  createReadStream(fileToSend).pipe(response);
}).listen(8080, () => {
  console.log("Running at http://localhost:8080");
});
