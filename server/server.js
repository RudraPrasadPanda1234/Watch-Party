require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { AccessToken } = require("livekit-server-sdk");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  PORT = 3000
} = process.env;

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public/index.html"))
);

const rooms = {}; // roomId -> host socket id

io.on("connection", socket => {

  socket.on("create-room", roomId => {
    rooms[roomId] = socket.id;
    socket.join(roomId);
    socket.emit("host", true);
    issueToken(socket, roomId);
  });

  socket.on("join-room", roomId => {
    socket.join(roomId);
    socket.emit("host", rooms[roomId] === socket.id);
    issueToken(socket, roomId);
  });

  socket.on("sync", ({ roomId, state }) => {
    socket.to(roomId).emit("sync", state);
  });

  socket.on("chat", ({ roomId, msg }) => {
    socket.to(roomId).emit("chat", msg);
  });

  function issueToken(socket, roomId) {
    const token = new AccessToken(
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      { identity: socket.id }
    );

    token.addGrant({
      room: roomId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true
    });

    socket.emit("livekit", {
      url: LIVEKIT_URL,
      token: token.toJwt()
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
