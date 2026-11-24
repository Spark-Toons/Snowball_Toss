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
const PLAYER_COLORS = [
  { name: "Red", value: "#ef5350" },
  { name: "Blue", value: "#42a5f5" },
  { name: "Green", value: "#66bb6a" },
  { name: "Yellow", value: "#ffd54f" },
];
const TARGET_MIN_X = 0.08;
const TARGET_MAX_X = 0.92;

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

function newTargets() {
  return [
    { id: "penguin", name: "Penguin", x: TARGET_MIN_X, y: 0.72, direction: 1, speed: 0.18, hitRadiusX: 0.085, hitRadiusY: 0.12, visible: true, hiddenUntil: 0 },
    { id: "airTarget", name: "Air Target", x: 0.73, y: 0.32, direction: 0, speed: 0, hitRadiusX: 0.06, hitRadiusY: 0.09, visible: true, hiddenUntil: 0 },
  ];
}

function moveTargets(room) {
  const now = Date.now();
  const elapsed = Math.min(Math.max(now - room.targetsUpdatedAt, 0) / 1000, 0.2);

  for (const target of room.targets) {
    if (target.hiddenUntil) {
      if (now < target.hiddenUntil) {
        target.visible = false;
        continue;
      }
      if (target.speed) {
        target.x = target.direction > 0 ? TARGET_MIN_X : TARGET_MAX_X;
      }
      target.hiddenUntil = 0;
      target.visible = true;
    }

    if (!target.speed) continue;
    target.x += target.direction * target.speed * elapsed;
    if (target.x <= TARGET_MIN_X) {
      target.x = TARGET_MIN_X;
      target.direction = 1;
    } else if (target.x >= TARGET_MAX_X) {
      target.x = TARGET_MAX_X;
      target.direction = -1;
    }
  }
  room.targetsUpdatedAt = now;
}

function roomState(room) {
  moveTargets(room);
  return {
    id: room.id,
    targets: room.targets.map(({ id, name, x, y, direction, visible }) => ({ id, name, x, y, direction, visible })),
    score: room.score,
    shots: room.shots,
    streak: room.streak,
    lastThrow: room.lastThrow,
    players: room.players.map((player) => ({ ...player })),
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
      targets: newTargets(),
      targetsUpdatedAt: Date.now(),
      score: 0,
      shots: 0,
      streak: 0,
      lastThrow: null,
      players: [],
    };
    rooms.set(id, room);
    json(response, 201, roomState(room));
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(\/join|\/throw)?$/i);
  if (roomMatch) {
    const room = rooms.get(roomMatch[1].toUpperCase());
    if (!room) {
      json(response, 404, { error: "That room code wasn't found. Ask the computer to start a new game." });
      return;
    }

    if (request.method === "POST" && roomMatch[2] === "/join") {
      try {
        const { playerId } = await readJson(request);
        const existingPlayer = room.players.find((player) => player.id === playerId);
        if (existingPlayer) {
          json(response, 200, { ...roomState(room), playerId: existingPlayer.id });
          return;
        }
        if (room.players.length >= PLAYER_COLORS.length) {
          json(response, 409, { error: "This game already has four players." });
          return;
        }

        const color = PLAYER_COLORS[room.players.length];
        const player = {
          id: crypto.randomUUID(),
          name: `Player ${room.players.length + 1}`,
          color: color.name,
          colorValue: color.value,
          score: 0,
          shots: 0,
          streak: 0,
        };
        room.players.push(player);
        json(response, 201, { ...roomState(room), playerId: player.id });
      } catch (error) {
        json(response, error.status || 400, { error: error.message });
      }
      return;
    }

    if (request.method === "GET" && !roomMatch[2]) {
      json(response, 200, roomState(room));
      return;
    }

    if (request.method === "POST" && roomMatch[2] === "/throw") {
      try {
        const { x, y, playerId } = await readJson(request);
        const player = room.players.find((entry) => entry.id === playerId);
        if (!player) {
          json(response, 403, { error: "Join this game before throwing." });
          return;
        }
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

        moveTargets(room);
        const target = room.targets.find((candidate) =>
          candidate.visible &&
          Math.hypot(
            (x - candidate.x) / candidate.hitRadiusX,
            (y - candidate.y) / candidate.hitRadiusY
          ) <= 1
        );
        const hit = Boolean(target);
        room.shots += 1;
        room.streak = hit ? room.streak + 1 : 0;
        player.shots += 1;
        player.streak = hit ? player.streak + 1 : 0;
        if (hit) room.score += 1;
        if (hit) player.score += 1;
        room.lastThrow = {
          id: room.shots,
          playerId: player.id,
          playerName: player.name,
          color: player.color,
          colorValue: player.colorValue,
          x,
          y,
          target: target ? { id: target.id, name: target.name, x: target.x, y: target.y } : null,
          hit,
        };
        if (target) {
          target.hiddenUntil = Date.now() + 650;
          target.visible = false;
        }
        json(response, 200, roomState(room));
      } catch (error) {
        json(response, error.status || 400, { error: error.message });
      }
      return;
    }
  }

  if (request.method === "GET") {
    const imageFiles = {
      "/game-background.png": "game-background.png",
      "/snowball.png": "snowball.png",
      "/snowball-player1.png": "snowball-player1.png",
      "/snowball-player2.png": "snowball-player2.png",
      "/snowball-player3.png": "snowball-player3.png",
      "/snowball-player4.png": "snowball-player4.png",
      "/penguin-walk.gif": "penguin-walk.gif",
      "/air-target.png": "air-target.png",
    };
    const image = imageFiles[url.pathname];
    if (image) {
      response.writeHead(200, {
        "Content-Type": image.endsWith(".gif") ? "image/gif" : "image/png",
        "Cache-Control": "public, max-age=3600",
      });
      fs.createReadStream(path.join(ROOT, image)).pipe(response);
      return;
    }
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
