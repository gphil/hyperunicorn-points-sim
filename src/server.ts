import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const encoder = new TextEncoder();
const reloadClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm"
};

const contentType = (filePath: string) =>
  mimeTypes[path.extname(filePath)] ?? "application/octet-stream";

const routePath = (pathname: string) => decodeURIComponent(pathname.replace(/^\/+/, ""));

const buildBrowserBundle = async () => {
  const startedAt = performance.now();
  const result = await Bun.build({
    entrypoints: [path.join(root, "src", "main.tsx")],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
    define: {
      "process.env.NODE_ENV": JSON.stringify("development")
    }
  });

  if (!result.success) {
    return new Response(result.logs.join("\n"), { status: 500 });
  }

  const output = result.outputs.find((file) => file.path.endsWith(".js"));
  console.info(`[dev] bundle ${(performance.now() - startedAt).toFixed(0)}ms`);

  return new Response(await output?.text(), {
    headers: { "Content-Type": "text/javascript; charset=utf-8" }
  });
};

const injectReload = (html: string) =>
  html.replace(
    "</body>",
    `<script>
      const source = new EventSource("/__reload");
      source.onmessage = () => window.location.reload();
    </script></body>`
  );

const serveFile = async (filePath: string) => {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file, {
    headers: { "Content-Type": contentType(filePath) }
  });
};

const notifyReload = () => {
  for (const client of reloadClients) {
    try {
      client.enqueue(encoder.encode("data: reload\n\n"));
    } catch {
      reloadClients.delete(client);
    }
  }
};

if (!isProduction) {
  for (const watchedPath of ["src", "public"]) {
    watch(path.join(root, watchedPath), { recursive: true }, notifyReload);
  }
}

const server = Bun.serve({
  port,
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url);

    if (!isProduction && url.pathname === "/__reload") {
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            reloadClients.add(controller);
            controller.enqueue(encoder.encode("retry: 1000\n\n"));
          },
          cancel() {
            if (streamController) {
              reloadClients.delete(streamController);
            }
          }
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          }
        }
      );
    }

    if (!isProduction && url.pathname === "/bundle.js") {
      return buildBrowserBundle();
    }

    if (!isProduction && url.pathname === "/") {
      const html = await readFile(path.join(root, "index.html"), "utf8");
      return new Response(injectReload(html), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    const baseDir = isProduction ? path.join(root, "dist") : root;
    const devPublicPath = path.join(root, "public", routePath(url.pathname));
    const filePath =
      url.pathname === "/"
        ? path.join(baseDir, "index.html")
        : !isProduction && (await Bun.file(devPublicPath).exists())
          ? devPublicPath
        : path.join(baseDir, routePath(url.pathname));

    return serveFile(filePath);
  }
});

console.info(`[server] http://localhost:${server.port} mode=${isProduction ? "prod" : "dev"}`);
