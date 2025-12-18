const socket = io();

let room;
let isHost = false;
let localStream;
let recorder;

const movie = document.getElementById("movie");
const movieInput = document.getElementById("movieInput");
const localCam = document.getElementById("localCam");
const remotes = document.getElementById("remotes");
const roomLink = document.getElementById("roomLink");
const hostBadge = document.getElementById("hostBadge");

const micBtn = document.getElementById("micBtn");
const camBtn = document.getElementById("camBtn");
const screenBtn = document.getElementById("screenBtn");
const recordBtn = document.getElementById("recordBtn");
const sendBtn = document.getElementById("sendBtn");

let micOn = true;
let camOn = true;

/* =========================
   ROOM ID LOGIC
========================= */
let roomId = location.hash.slice(1);

/* Auto-join if link opened */
if (roomId) {
  joinRoom(roomId);
}

/* =========================
   CREATE / JOIN ROOM
========================= */
document.getElementById("createRoom").onclick = async () => {
  roomId = Math.random().toString(36).substring(2);
  location.hash = roomId;
  roomLink.value = location.href;
  await startMedia();
  socket.emit("create-room", roomId);
};

document.getElementById("joinRoom").onclick = async () => {
  const id = roomId || prompt("Enter Room ID");
  if (!id) return;
  roomId = id;
  location.hash = roomId;
  roomLink.value = location.href;
  await startMedia();
  socket.emit("join-room", roomId);
};

async function joinRoom(id) {
  roomLink.value = location.href;
  await startMedia();
  socket.emit("join-room", id);
}

/* =========================
   LOCAL MEDIA
========================= */
async function startMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });
  localCam.srcObject = localStream;
  await localCam.play();
}

/* =========================
   HOST INFO
========================= */
socket.on("host", h => {
  isHost = h;
  hostBadge.style.display = h ? "inline" : "none";
  movieInput.disabled = !h;
});

/* =========================
   LIVEKIT CONNECT
========================= */
socket.on("livekit", async ({ url, token }) => {
  room = new LiveKit.Room();

  room.on(LiveKit.RoomEvent.TrackSubscribed, (track, pub, participant) => {

    /* 🎬 MOVIE VIDEO TRACK */
    if (pub.trackName === "movie") {
      const stream = new MediaStream([track.mediaStreamTrack]);
      movie.srcObject = stream;
      movie.controls = false;
      movie.muted = false;
      movie.play();
      return;
    }

    /* 🔊 MOVIE AUDIO TRACK */
    if (pub.trackName === "movie-audio") {
      const audio = document.createElement("audio");
      audio.srcObject = new MediaStream([track.mediaStreamTrack]);
      audio.autoplay = true;
      return;
    }

    /* 👤 CAMERA TRACKS */
    remotes.appendChild(track.attach());
  });

  await room.connect(url, token);

  /* Publish camera + mic */
  for (const t of localStream.getTracks()) {
    await room.localParticipant.publishTrack(t);
  }
});

/* =========================
   MIC / CAMERA TOGGLE
========================= */
micBtn.onclick = () => {
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => (t.enabled = micOn));
  micBtn.textContent = micOn ? "🎤" : "🔇";
  micBtn.classList.toggle("off", !micOn);
};

camBtn.onclick = () => {
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => (t.enabled = camOn));
  camBtn.textContent = camOn ? "📷" : "🚫";
  camBtn.classList.toggle("off", !camOn);
};

/* =========================
   MOVIE FILE (HOST ONLY)
========================= */
movieInput.onchange = async () => {
  if (!isHost) return;

  movie.src = URL.createObjectURL(movieInput.files[0]);
  movie.muted = true;
  await movie.play();

  const stream = movie.captureStream();

  /* Remove old movie tracks */
  room.localParticipant.videoTracks.forEach(pub => {
    if (pub.trackName === "movie") {
      room.localParticipant.unpublishTrack(pub.track);
    }
  });

  room.localParticipant.audioTracks.forEach(pub => {
    if (pub.trackName === "movie-audio") {
      room.localParticipant.unpublishTrack(pub.track);
    }
  });

  /* Publish movie video */
  for (const track of stream.getVideoTracks()) {
    await room.localParticipant.publishTrack(track, { name: "movie" });
  }

  /* Publish movie audio */
  for (const track of stream.getAudioTracks()) {
    await room.localParticipant.publishTrack(track, { name: "movie-audio" });
  }
};

/* =========================
   SCREEN SHARE (HOST ONLY)
========================= */
screenBtn.onclick = async () => {
  if (!isHost) return;

  const screen = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true
  });

  movie.srcObject = screen;
  await movie.play();

  for (const track of screen.getTracks()) {
    await room.localParticipant.publishTrack(track, { name: "movie" });
  }
};

/* =========================
   RECORD (HOST ONLY)
========================= */
recordBtn.onclick = () => {
  if (!isHost) return;

  if (!recorder) {
    const stream = movie.srcObject || movie.captureStream();
    recorder = new MediaRecorder(stream);

    recorder.ondataavailable = e => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(e.data);
      a.download = "recording.webm";
      a.click();
    };

    recorder.start();
    recordBtn.classList.add("recording");
  } else {
    recorder.stop();
    recorder = null;
    recordBtn.classList.remove("recording");
  }
};

/* =========================
   CHAT
========================= */
sendBtn.onclick = () => {
  const input = document.getElementById("chatInput");
  socket.emit("chat", { roomId, msg: input.value });
  input.value = "";
};

socket.on("chat", msg => {
  const d = document.createElement("div");
  d.textContent = msg;
  document.getElementById("messages").appendChild(d);
});

/* =========================
   SYNC (HOST → VIEWERS)
========================= */
movie.onplay = () => isHost && sync("play");
movie.onpause = () => isHost && sync("pause");
movie.onseeking = () => isHost && sync("seek");

function sync(type) {
  socket.emit("sync", {
    roomId,
    state: { type, time: movie.currentTime }
  });
}

socket.on("sync", s => {
  if (isHost) return;
  movie.currentTime = s.time;
  s.type === "play" ? movie.play() : movie.pause();
});
