import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Serves the same /api handlers that Vercel runs in production, so `npm run dev` is one process.
function apiDevServer(): Plugin {
  return {
    name: "api-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/") || req.method !== "POST") return next();
        const name = req.url.slice(5).split("?")[0];
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const request = new Request(`http://localhost${req.url}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: Buffer.concat(chunks),
          });
          const response: Response = await mod.POST(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          // Pass streamed bodies through as they arrive, like Vercel does.
          if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
          res.end();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), apiDevServer()] };
});
