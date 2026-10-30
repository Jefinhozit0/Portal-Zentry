import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { startWhatsAppWeb } from "./whatsappWeb";
import { registerShortLinks } from "./shortLinks";
import { startBackgroundJobs } from "./tarefas";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  // The tunnel (Tailscale Funnel or Cloudflare) connects from this machine; trust it so req.ip is the visitor, not 127.0.0.1.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    // No other site may show the portal inside a frame (clickjacking).
    res.set("X-Frame-Options", "DENY");
    res.set("Content-Security-Policy", "frame-ancestors 'none'");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // Browsers ignore this header over plain http (localhost), so it only pins the public HTTPS address.
    res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerShortLinks(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = ENV.whatsappProvider === "web" ? preferredPort : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    if (ENV.whatsappProvider === "web") {
      startWhatsAppWeb().catch((error) => console.error("[WhatsApp] Não foi possível iniciar a conexão:", error));
    }
  });

  // Daily backup and access reminders. BACKGROUND_JOBS=off turns them off (e.g. on a test copy).
  if ((process.env.BACKGROUND_JOBS ?? "on").toLowerCase() !== "off") startBackgroundJobs();
}

startServer().catch(console.error);
