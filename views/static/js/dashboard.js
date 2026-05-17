// ── Constants ────────────────────────────────────────────────
const LOCAL_CAMERA_ID = "web_client";
const WARMUP_FRAMES = 200;
const THRESHOLD_RATIO = 0.01;
const CHART_POINTS = 60;

// ── Elements ─────────────────────────────────────────────────
const video = document.getElementById("video");
const displayCanvas = document.getElementById("canvas");
const overlayCanvas = document.getElementById("overlay-canvas");
const captureCanvas = document.getElementById("capture-canvas");
const ratioChart = document.getElementById("ratio-chart");
const motionFlash = document.getElementById("motion-flash");
const placeholder = document.getElementById("placeholder");
const espPlaceholder = document.getElementById("esp-placeholder");
const espFeed = document.getElementById("esp-feed");

const dCtx = displayCanvas.getContext("2d");
const oCtx = overlayCanvas.getContext("2d");
const cCtx = captureCanvas.getContext("2d");
const chartCtx = ratioChart.getContext("2d");

const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnReset = document.getElementById("btn-reset");
const btnSnapshot = document.getElementById("btn-snapshot");
const fpsRange = document.getElementById("fps-range");
const fpsLabel = document.getElementById("fps-label");
const toggleSound = document.getElementById("toggle-sound");
const toggleAutosnap = document.getElementById("toggle-autosnap");
const toggleSoundEsp = document.getElementById("toggle-sound-esp");

// ── State ─────────────────────────────────────────────────────
let currentMode = "local"; // "local" | "esp"
let stream = null;
let sendTimer = null;
let isSending = false;
let frameCount = 0;
let lastMotion = false;
let motionEvents = 0;
let sessionStart = null;
let sessionTick = null;
let audioCtx = null;
let ratioHistory = new Array(CHART_POINTS).fill(0);
let autoSnapLast = false;

// ESP state
let espCamId = "";
let espApiKey = "";
let espPollTimer = null;
let espConnected = false;

// ── Modal (ESP32-CAM connect) ──────────────────────────────────
function openEspModal() {
  const modal = document.getElementById("esp-modal");
  const errEl = document.getElementById("esp-error");
  errEl.style.display = "none";
  modal.classList.add("open");
  // Focus vào trường đầu tiên
  setTimeout(() => document.getElementById("esp-cam-id").focus(), 80);
}

function closeEspModal() {
  document.getElementById("esp-modal").classList.remove("open");
}

function handleModalBackdropClick(e) {
  // Đóng khi click vào backdrop (không phải modal-box)
  if (e.target === document.getElementById("esp-modal")) {
    closeEspModal();
  }
}

// Đóng modal bằng Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEspModal();
});

// Enter trong input → submit
["esp-cam-id", "esp-api-key"].forEach((id) => {
  document.getElementById(id)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectEsp();
  });
});

// ── Mode switching ─────────────────────────────────────────────
function switchMode(mode) {
  if (mode === currentMode) return;

  if (currentMode === "local") stopAll();
  if (currentMode === "esp") disconnectEsp();

  currentMode = mode;

  document
    .getElementById("tab-local")
    .classList.toggle("tab-active", mode === "local");
  document
    .getElementById("tab-esp")
    .classList.toggle("tab-active", mode === "esp");
  document.getElementById("local-controls").style.display =
    mode === "local" ? "" : "none";
  document.getElementById("esp-controls").style.display =
    mode === "esp" ? "" : "none";

  if (mode === "local") {
    espFeed.style.display = "none";
    espPlaceholder.style.display = "none";
    displayCanvas.style.display = "";
    placeholder.style.display = "";
    document.getElementById("camera-label").textContent = "📷 Webcam local";
    setStatus("stopped");
  } else {
    displayCanvas.style.display = "none";
    placeholder.style.display = "none";
    espFeed.style.display = "none";
    espPlaceholder.style.display = ""; // Hiện placeholder ESP
    document.getElementById("camera-label").textContent = "📡 ESP32-CAM";
    setStatus("stopped");
  }
}

// ── ESP32-CAM connection ───────────────────────────────────────
function connectEsp() {
  const camId = document.getElementById("esp-cam-id").value.trim();
  const apiKey = document.getElementById("esp-api-key").value.trim();
  const errEl = document.getElementById("esp-error");
  const btnConnect = document.getElementById("btn-modal-connect");

  errEl.style.display = "none";
  if (!camId || !apiKey) {
    errEl.textContent = "Vui lòng nhập Camera ID và API Key";
    errEl.style.display = "";
    return;
  }

  // Loading state
  btnConnect.disabled = true;
  btnConnect.textContent = "Đang kết nối...";

  fetch(`/api/cameras/${encodeURIComponent(camId)}/status`)
    .then((r) => {
      if (!r.ok)
        throw new Error(`Camera '${camId}' chưa gửi frame nào lên server`);
      return r.json();
    })
    .then((data) => {
      if (!data.has_frame)
        throw new Error("Camera chưa có frame — ESP32 chưa kết nối?");

      espCamId = camId;
      espApiKey = apiKey;

      // Hiện MJPEG stream
      espFeed.onerror = () => {
        addLog("❌ Stream lỗi — kiểm tra Camera ID / API Key", "log-motion");
        disconnectEsp();
      };
      espFeed.src = `/api/cameras/${encodeURIComponent(camId)}/mjpeg?api_key=${encodeURIComponent(apiKey)}`;
      espFeed.style.display = "";
      espPlaceholder.style.display = "none";
      espConnected = true;

      // Cập nhật controls
      document.getElementById("esp-cam-label").textContent = camId;
      document.getElementById("btn-esp-reset").disabled = false;
      document.getElementById("btn-esp-disconnect").style.display = "";
      // Ẩn nút "Kết nối" khi đã connected, chỉ hiện "Ngắt kết nối"
      document.querySelector("#esp-controls .btn-primary").style.display =
        "none";

      setStatus("live");
      document.getElementById("cam-dot").classList.add("live");
      addLog(`📡 Đã kết nối ESP32-CAM: ${camId}`, "log-info");
      startSessionTimer();

      // Poll metrics mỗi 2s
      espPollTimer = setInterval(() => pollEspStatus(camId), 2000);

      // Đóng modal
      closeEspModal();
    })
    .catch((err) => {
      errEl.textContent = err.message;
      errEl.style.display = "";
    })
    .finally(() => {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M1 7a6 6 0 0 1 12 0" />
        <path d="M3.5 9a4 4 0 0 1 7 0" stroke-dasharray="2 1.5"/>
        <circle cx="7" cy="11" r="1.5" fill="currentColor" stroke="none"/>
      </svg> Kết nối`;
    });
}

function disconnectEsp() {
  clearInterval(espPollTimer);
  espPollTimer = null;
  espConnected = false;
  espFeed.src = "";
  espFeed.style.display = "none";
  espPlaceholder.style.display = currentMode === "esp" ? "" : "none";

  document.getElementById("cam-dot").classList.remove("live");
  document.getElementById("btn-esp-reset").disabled = true;
  document.getElementById("btn-esp-disconnect").style.display = "none";
  // Hiện lại nút kết nối
  document.querySelector("#esp-controls .btn-primary").style.display = "";

  setStatus("stopped");
  stopSessionTimer();
  addLog("📡 Đã ngắt kết nối ESP32-CAM", "log-info");
}

async function pollEspStatus(camId) {
  try {
    const t0 = performance.now();
    const res = await fetch(`/api/cameras/${encodeURIComponent(camId)}/status`);
    if (!res.ok) return;
    const data = await res.json();
    const ping = Math.round(performance.now() - t0);

    const fakeData = {
      camera_id: data.camera_id,
      motion_detected: data.motion_detected,
      foreground_ratio: data.foreground_ratio,
      foreground_pixels: 0,
      total_pixels: 1,
      warming_up: data.warming_up,
      frame_count: data.frame_count,
    };
    updateUI(fakeData, ping, toggleSoundEsp.checked);
  } catch (_) {}
}

async function resetEspBg() {
  if (!espCamId || !espApiKey) return;
  await fetch(`/api/cameras/${encodeURIComponent(espCamId)}`, {
    method: "DELETE",
    headers: { "X-API-Key": espApiKey },
  });
  ratioHistory = new Array(CHART_POINTS).fill(0);
  addLog("🔄 Background ESP đã reset", "log-warm");
}

// ── Session timer ────────────────────────────────────────────
function startSessionTimer() {
  sessionStart = Date.now();
  sessionTick = setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    document.getElementById("session-time").textContent = `${h}:${m}:${s}`;
  }, 1000);
}
function stopSessionTimer() {
  clearInterval(sessionTick);
  sessionTick = null;
}

// ── Audio ─────────────────────────────────────────────────────
function ensureAudio() {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function playBeep(freq = 880, duration = 0.18, type = "square") {
  try {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioCtx.currentTime + duration,
    );
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (_) {}
}

// ── Chart ─────────────────────────────────────────────────────
function drawChart() {
  const W = ratioChart.parentElement.clientWidth - 32;
  const H = 80;
  ratioChart.width = W;
  ratioChart.height = H;
  chartCtx.clearRect(0, 0, W, H);

  const grad = chartCtx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(56,189,248,0.35)");
  grad.addColorStop(1, "rgba(56,189,248,0.01)");

  const step = W / (CHART_POINTS - 1);
  const max = Math.max(...ratioHistory, THRESHOLD_RATIO * 3, 0.01);

  chartCtx.beginPath();
  ratioHistory.forEach((v, i) => {
    const x = i * step,
      y = H - (v / max) * (H - 6);
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });
  chartCtx.lineTo((CHART_POINTS - 1) * step, H);
  chartCtx.lineTo(0, H);
  chartCtx.closePath();
  chartCtx.fillStyle = grad;
  chartCtx.fill();

  chartCtx.beginPath();
  ratioHistory.forEach((v, i) => {
    const x = i * step,
      y = H - (v / max) * (H - 6);
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });
  chartCtx.strokeStyle = "#38bdf8";
  chartCtx.lineWidth = 1.8;
  chartCtx.lineJoin = "round";
  chartCtx.stroke();

  const ty = H - (THRESHOLD_RATIO / max) * (H - 6);
  chartCtx.beginPath();
  chartCtx.setLineDash([4, 4]);
  chartCtx.moveTo(0, ty);
  chartCtx.lineTo(W, ty);
  chartCtx.strokeStyle = "rgba(239,68,68,0.6)";
  chartCtx.lineWidth = 1.2;
  chartCtx.stroke();
  chartCtx.setLineDash([]);
}

// ── Snapshot ──────────────────────────────────────────────────
function takeSnapshot(label = "snapshot") {
  if (!stream) return;
  cCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  captureCanvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const ts = new Date().toLocaleTimeString().replace(/:/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `motion_${ts}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
      addLog(`📸 Đã chụp ảnh (${label})`, "log-snap");
    },
    "image/jpeg",
    0.92,
  );
}

// ── FPS slider ────────────────────────────────────────────────
fpsRange.addEventListener("input", () => {
  fpsLabel.textContent = fpsRange.value;
  if (sendTimer) restartTimer();
});

// ── Start local cam ───────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;

    video.addEventListener(
      "loadedmetadata",
      async () => {
        displayCanvas.width = video.videoWidth;
        displayCanvas.height = video.videoHeight;
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;
        await video.play();
        placeholder.style.display = "none";
        requestAnimationFrame(drawFrame);
        startSending();
        startSessionTimer();
      },
      { once: true },
    );

    btnStart.disabled = true;
    btnStop.disabled = false;
    btnReset.disabled = false;
    btnSnapshot.disabled = false;
    setStatus("live");
    document.getElementById("cam-dot").classList.add("live");
    addLog("📷 Camera đã kết nối", "log-info");
  } catch (e) {
    addLog("❌ Không thể mở camera: " + e.message, "log-motion");
  }
});

btnStop.addEventListener("click", () => {
  stopAll();
  addLog("⏹ Đã dừng phiên", "log-info");
});

btnReset.addEventListener("click", async () => {
  await fetch(`/api/cameras/${LOCAL_CAMERA_ID}`, { method: "DELETE" });
  frameCount = 0;
  ratioHistory = new Array(CHART_POINTS).fill(0);
  document.getElementById("stat-frames").textContent = "0";
  document.getElementById("stat-warmup").textContent = WARMUP_FRAMES;
  addLog("🔄 Background đã reset", "log-warm");
});

btnSnapshot.addEventListener("click", () => takeSnapshot("manual"));

// ── Draw / send ───────────────────────────────────────────────
function drawFrame() {
  if (!stream) return;
  if (video.readyState >= video.HAVE_CURRENT_DATA)
    dCtx.drawImage(video, 0, 0, displayCanvas.width, displayCanvas.height);
  requestAnimationFrame(drawFrame);
}

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
        const res = await fetch(`/api/cameras/${LOCAL_CAMERA_ID}/predict`, {
          method: "POST",
          body: form,
        });
        const ping = Math.round(performance.now() - t0);
        const data = await res.json();
        updateUI(data, ping, toggleSound.checked);
      } catch (_) {
        addLog("❌ Lỗi kết nối server", "log-motion");
      }
      isSending = false;
    },
    "image/jpeg",
    0.7,
  );
}

// ── Update UI (dùng chung local & ESP) ───────────────────────
function updateUI(data, ping, soundEnabled = false) {
  frameCount = data.frame_count;
  const ratio = (data.foreground_ratio * 100).toFixed(2);
  const warmLeft = Math.max(0, WARMUP_FRAMES - data.frame_count);
  const isMotion = data.motion_detected && !data.warming_up;

  document.getElementById("stat-frames").textContent = data.frame_count;
  document.getElementById("stat-warmup").textContent = data.warming_up
    ? warmLeft
    : "✅ Done";
  document.getElementById("stat-ratio").textContent = ratio + "%";
  document.getElementById("stat-pixels").textContent = (
    data.foreground_pixels || 0
  ).toLocaleString();
  document.getElementById("stat-ping").textContent = ping + " ms";
  document.getElementById("stat-events").textContent = motionEvents;

  const barPct =
    Math.min(data.foreground_ratio / (THRESHOLD_RATIO * 5), 1) * 100;
  const thresholdPct = (THRESHOLD_RATIO / (THRESHOLD_RATIO * 5)) * 100;
  document.getElementById("ratio-bar").style.width = barPct + "%";
  document.getElementById("threshold-marker").style.left = thresholdPct + "%";

  ratioHistory.push(data.foreground_ratio);
  if (ratioHistory.length > CHART_POINTS) ratioHistory.shift();
  drawChart();

  const box = document.getElementById("motion-status");
  if (data.warming_up) {
    const pct = Math.round((data.frame_count / WARMUP_FRAMES) * 100);
    box.innerHTML = `<div class="motion-icon">⏳</div><div class="motion-text">Warming up ${pct}%</div>`;
    box.className = "motion-indicator motion-warm";
  } else if (isMotion) {
    box.innerHTML = `<div class="motion-icon">🚨</div><div class="motion-text">Có chuyển động!</div>`;
    box.className = "motion-indicator motion-on";
    if (!lastMotion) {
      motionEvents++;
      document.getElementById("motion-event-count").textContent = motionEvents;
      addLog(`🚨 Phát hiện chuyển động! FG=${ratio}%`, "log-motion");
      motionFlash.classList.add("active");
      setTimeout(() => motionFlash.classList.remove("active"), 500);
      if (soundEnabled) playBeep(880, 0.2, "square");
      if (toggleAutosnap?.checked && !autoSnapLast && currentMode === "local")
        takeSnapshot("auto");
    }
  } else {
    box.innerHTML = `<div class="motion-icon">✅</div><div class="motion-text">Bình thường</div>`;
    box.className = "motion-indicator motion-off";
    if (lastMotion) addLog("✅ Không còn chuyển động", "log-clear");
  }
  autoSnapLast = isMotion;
  lastMotion = isMotion;
}

// ── Log ───────────────────────────────────────────────────────
function addLog(msg, cls = "log-info") {
  const log = document.getElementById("log");
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 120) log.removeChild(log.firstChild);
}

function clearLog() {
  document.getElementById("log").innerHTML =
    '<div class="log-info">── Log đã xóa ──</div>';
}

// ── Status badge ──────────────────────────────────────────────
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

// ── Cleanup local ─────────────────────────────────────────────
function stopAll() {
  clearInterval(sendTimer);
  sendTimer = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnReset.disabled = true;
  btnSnapshot.disabled = true;
  setStatus("stopped");
  document.getElementById("cam-dot").classList.remove("live");
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  stopSessionTimer();
  placeholder.style.display = "";
}

// ── Init ──────────────────────────────────────────────────────
drawChart();
window.addEventListener("resize", drawChart);
