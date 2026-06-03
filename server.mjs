import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const siteRoot = join(root, "site");
const port = Number(process.env.PORT || readEnv().PORT || 8787);

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
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/voice-token") {
    await handleToken(res);
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(siteRoot, safePath);

  if (!filePath.startsWith(siteRoot) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
});

async function handleToken(res) {
  if (!env.ASSEMBLYAI_API_KEY) {
    sendJson(res, 500, {
      error: "Missing ASSEMBLYAI_API_KEY. Add it to .env on the server."
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
        details: payload
      });
      return;
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, {
      error: "Could not reach AssemblyAI token endpoint.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

server.listen(port, "127.0.0.1", () => {
  console.log(`PitchPanel AI is running at http://127.0.0.1:${port}`);
});
