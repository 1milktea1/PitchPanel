import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const siteRoot = join(root, "site");
const isProduction = process.env.NODE_ENV === "production";
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || readEnv().PORT || 8787);

const TOKEN_RATE_WINDOW_MS = 60_000;
const TOKEN_RATE_MAX = 10;
const tokenRateByIp = new Map();

function readEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return {};

  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      })
  );
}

const env = { ...readEnv(), ...process.env };

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg"
};

const server = createServer(async (req, res) => {
  setSecurityHeaders(res);

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/voice-token") {
    if (req.method !== "GET" && req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    await handleToken(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(siteRoot, safePath);

  if (!filePath.startsWith(siteRoot) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const headers = { "content-type": types[extname(filePath)] || "application/octet-stream" };
  if (isProduction && extname(filePath) !== ".html") {
    headers["cache-control"] = "public, max-age=86400";
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
});

async function handleToken(req, res) {
  const clientIp = getClientIp(req);

  if (isRateLimited(clientIp)) {
    sendJson(res, 429, { error: "Too many token requests. Try again in a minute." });
    return;
  }

  if (!env.ASSEMBLYAI_API_KEY) {
    sendJson(res, 500, {
      error: isProduction
        ? "Voice service is not configured."
        : "Missing ASSEMBLYAI_API_KEY. Add it to .env on the server."
    });
    return;
  }

  try {
    const response = await fetch(
      "https://agents.assemblyai.com/v1/token?expires_in_seconds=120&max_session_duration_seconds=900",
      { headers: { Authorization: `Bearer ${env.ASSEMBLYAI_API_KEY}` } }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      sendJson(res, response.status, {
        error: "AssemblyAI token request failed.",
        ...(isProduction ? {} : { details: payload })
      });
      return;
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, {
      error: "Could not reach AssemblyAI token endpoint.",
      ...(isProduction
        ? {}
        : { details: error instanceof Error ? error.message : String(error) })
    });
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(clientIp) {
  const now = Date.now();
  const current = tokenRateByIp.get(clientIp);

  if (!current || now - current.windowStart > TOKEN_RATE_WINDOW_MS) {
    tokenRateByIp.set(clientIp, { windowStart: now, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > TOKEN_RATE_MAX;
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "microphone=(self)");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

server.listen(port, host, () => {
  const label = host === "0.0.0.0" ? "localhost" : host;
  console.log(`PitchPanel AI is running at http://${label}:${port}`);
});
