const http = require("node:http");
const os = require("node:os");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "public");
const rooms = new Map();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const START = { x: 0.5, y: 0.86 };

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function newTarget() {
  return {
    x: 0.14 + Math.random() * 0.72,
    y: 0.13 + Math.random() * 0.48,
  };
}

function roomState(room) {
  return {
    id: room.id,
    target: room.target,
    score: room.score,
    shots: room.shots,
    streak: room.streak,
    lastThrow: room.lastThrow,
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        const error = new Error("Request body is too large.");
        error.status = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("Request body must be valid JSON.");
        error.status = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function info() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return {
    port: PORT,
    urls: [...new Set(addresses)].map((address) => `http://${address}:${PORT}`),
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/info") {
    json(response, 200, info());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/qr") {
    const roomId = (url.searchParams.get("room") || "").toUpperCase();
    if (!rooms.has(roomId)) {
      json(response, 404, { error: "That room code wasn't found. Start a new game and scan its QR code." });
      return;
    }

    try {
      const forwardedProto = request.headers["x-forwarded-proto"];
      const protocol = forwardedProto
        ? forwardedProto.split(",")[0].trim()
        : request.socket.encrypted ? "https" : "http";
      if (protocol !== "https" && protocol !== "http") {
        json(response, 400, { error: "Could not determine the game address." });
        return;
      }
      let host = request.headers["x-forwarded-host"]
        ? request.headers["x-forwarded-host"].split(",")[0].trim()
        : request.headers.host;
      const hostname = new URL(`${protocol}://${host}`).hostname;
      if (
        (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") &&
        !process.env.RENDER
      ) {
        const lanUrl = info().urls[0];
        if (lanUrl) host = new URL(lanUrl).host;
      }
      const joinUrl = `${protocol}://${host}/?room=${roomId}`;
      const dataUrl = await QRCode.toDataURL(joinUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 220,
      });
      json(response, 200, { url: joinUrl, dataUrl });
    } catch (error) {
      console.error("Could not generate the room QR code:", error);
      json(response, 500, { error: "Could not generate the room QR code." });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const id = newCode();
    const room = {
      id,
      target: newTarget(),
      score: 0,
      shots: 0,
      streak: 0,
      lastThrow: null,
    };
    rooms.set(id, room);
    json(response, 201, roomState(room));
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(\/throw)?$/i);
  if (roomMatch) {
    const room = rooms.get(roomMatch[1].toUpperCase());
    if (!room) {
      json(response, 404, { error: "That room code wasn't found. Ask the computer to start a new game." });
      return;
    }

    if (request.method === "GET" && !roomMatch[2]) {
      json(response, 200, roomState(room));
      return;
    }

    if (request.method === "POST" && roomMatch[2]) {
      try {
        const { x, y } = await readJson(request);
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > 1 ||
          y < 0 ||
          y > 1
        ) {
          json(response, 400, { error: "Aim coordinates must be between 0 and 1." });
          return;
        }

        const target = room.target;
        const miss = Math.hypot((x - target.x) * 1.6, y - target.y);
        const hit = miss <= 0.11;
        room.shots += 1;
        room.streak = hit ? room.streak + 1 : 0;
        if (hit) room.score += 1;
        room.lastThrow = {
          id: room.shots,
          x,
          y,
          target,
          hit,
        };
        room.target = newTarget();
        json(response, 200, roomState(room));
      } catch (error) {
        json(response, error.status || 400, { error: error.message });
      }
      return;
    }
  }

  if (request.method === "GET") {
    const files = {
      "/": "index.html",
      "/index.html": "index.html",
    };
    const filename = files[url.pathname];
    if (filename) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(path.join(ROOT, filename)).pipe(response);
      return;
    }
  }

  json(response, 404, { error: "Not found." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Snowball Toss is ready on port ${PORT}.`);
  const { urls } = info();
  if (urls.length) {
    console.log("Open one of these addresses on your computer and phone (same Wi-Fi):");
    for (const address of urls) console.log(`  ${address}`);
  } else {
    console.log(`Open http://localhost:${PORT} on your computer.`);
  }
});
