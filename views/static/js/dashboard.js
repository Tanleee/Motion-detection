const CAMERA_ID = "web_client";

const video = document.getElementById("video");
const displayCanvas = document.getElementById("canvas");
const overlayCanvas = document.getElementById("overlay-canvas");
const captureCanvas = document.getElementById("capture-canvas");
const dCtx = displayCanvas.getContext("2d");
const oCtx = overlayCanvas.getContext("2d");
const cCtx = captureCanvas.getContext("2d");

const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnReset = document.getElementById("btn-reset");
const fpsRange = document.getElementById("fps-range");
const fpsLabel = document.getElementById("fps-label");

let stream = null;
let sendTimer = null;
let isSending = false;
let frameCount = 0;
let lastMotion = false;

// ── FPS slider ──────────────────────────────────────────
fpsRange.addEventListener("input", () => {
  fpsLabel.textContent = fpsRange.value;
  if (sendTimer) restartTimer();
});

// ── Start ────────────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;

    // FIX 1: dùng addEventListener + { once: true } tránh race condition
    video.addEventListener(
      "loadedmetadata",
      async () => {
        displayCanvas.width = video.videoWidth;
        displayCanvas.height = video.videoHeight;
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;

        // FIX 2: gọi video.play() tường minh
        await video.play();

        requestAnimationFrame(drawFrame);
        startSending();
      },
      { once: true },
    );

    btnStart.disabled = true;
    btnStop.disabled = false;
    btnReset.disabled = false;
    setStatus("live");
    addLog("Camera đã kết nối", "log-info");
  } catch (e) {
    addLog("❌ Không thể mở camera: " + e.message, "log-motion");
  }
});

// ── Stop ────────────────────────────────────────────────
btnStop.addEventListener("click", () => {
  stopAll();
  addLog("Đã dừng", "log-info");
});

// ── Reset background ────────────────────────────────────
btnReset.addEventListener("click", async () => {
  await fetch(`/api/cameras/${CAMERA_ID}`, { method: "DELETE" });
  frameCount = 0;
  document.getElementById("stat-frames").textContent = "0";
  document.getElementById("stat-warmup").textContent = "200";
  addLog("🔄 Background đã reset — warm-up lại từ đầu", "log-warm");
});

// ── Vẽ video lên canvas hiển thị ───────────────────────
function drawFrame() {
  if (!stream) return;
  // FIX 3: kiểm tra video đã có dữ liệu trước khi vẽ
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    dCtx.drawImage(video, 0, 0, displayCanvas.width, displayCanvas.height);
  }
  requestAnimationFrame(drawFrame);
}

// ── Gửi frame định kỳ ──────────────────────────────────
function startSending() {
  const interval = 1000 / parseInt(fpsRange.value);
  sendTimer = setInterval(sendFrame, interval);
}

function restartTimer() {
  clearInterval(sendTimer);
  startSending();
}

async function sendFrame() {
  if (isSending || !stream) return;
  if (video.readyState < video.HAVE_CURRENT_DATA) return;
  isSending = true;

  cCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

  captureCanvas.toBlob(
    async (blob) => {
      if (!blob) {
        isSending = false;
        return;
      }

      const form = new FormData();
      form.append("file", blob, "frame.jpg");

      const t0 = performance.now();
      try {
        const res = await fetch(`/api/cameras/${CAMERA_ID}/predict`, {
          method: "POST",
          body: form,
        });
        const ping = Math.round(performance.now() - t0);
        const data = await res.json();
        updateUI(data, ping);
      } catch (e) {
        addLog("❌ Lỗi kết nối server", "log-motion");
      }

      isSending = false;
    },
    "image/jpeg",
    0.7,
  );
}

// ── Cập nhật UI sau mỗi response ───────────────────────
function updateUI(data, ping) {
  frameCount = data.frame_count;
  const ratio = (data.foreground_ratio * 100).toFixed(2);
  const warmLeft = Math.max(0, 200 - data.frame_count);

  document.getElementById("stat-frames").textContent = data.frame_count;
  document.getElementById("stat-warmup").textContent = data.warming_up
    ? warmLeft
    : "✅ Done";
  document.getElementById("stat-ratio").textContent = ratio + "%";
  document.getElementById("stat-pixels").textContent =
    data.foreground_pixels.toLocaleString();
  document.getElementById("stat-ping").textContent = ping + " ms";
  document.getElementById("ratio-bar").style.width =
    Math.min(ratio * 5, 100) + "%";

  const box = document.getElementById("motion-status");
  if (data.warming_up) {
    box.textContent = "⏳ Warming up";
    box.className = "motion-indicator motion-warm";
  } else if (data.motion_detected) {
    box.textContent = "🚨 CÓ CHUYỂN ĐỘNG!";
    box.className = "motion-indicator motion-on";
    if (!lastMotion)
      addLog(`🚨 Phát hiện chuyển động! FG=${ratio}%`, "log-motion");
  } else {
    box.textContent = "✅ Bình thường";
    box.className = "motion-indicator motion-off";
    if (lastMotion) addLog("✅ Không còn chuyển động", "log-clear");
  }

  lastMotion = data.motion_detected && !data.warming_up;
}

// ── Log ────────────────────────────────────────────────
function addLog(msg, cls = "log-info") {
  const log = document.getElementById("log");
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 100) log.removeChild(log.firstChild);
}

// ── Status badge ───────────────────────────────────────
function setStatus(state) {
  const badge = document.getElementById("status-badge");
  if (state === "live") {
    badge.textContent = "🔴 LIVE";
    badge.className = "badge live";
  } else {
    badge.textContent = "⏹ Chưa bắt đầu";
    badge.className = "badge";
  }
}

// ── Cleanup ────────────────────────────────────────────
function stopAll() {
  clearInterval(sendTimer);
  sendTimer = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnReset.disabled = true;
  setStatus("stopped");
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}
