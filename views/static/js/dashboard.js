// ── Constants ────────────────────────────────────────────────
const CAMERA_ID       = "web_client";
const WARMUP_FRAMES   = 200;
const THRESHOLD_RATIO = 0.01;
const CHART_POINTS    = 60;

// ── Elements ─────────────────────────────────────────────────
const video         = document.getElementById("video");
const displayCanvas = document.getElementById("canvas");
const overlayCanvas = document.getElementById("overlay-canvas");
const captureCanvas = document.getElementById("capture-canvas");
const ratioChart    = document.getElementById("ratio-chart");
const motionFlash   = document.getElementById("motion-flash");
const placeholder   = document.getElementById("placeholder");

const dCtx = displayCanvas.getContext("2d");
const oCtx = overlayCanvas.getContext("2d");
const cCtx = captureCanvas.getContext("2d");
const chartCtx = ratioChart.getContext("2d");

const btnStart    = document.getElementById("btn-start");
const btnStop     = document.getElementById("btn-stop");
const btnReset    = document.getElementById("btn-reset");
const btnSnapshot = document.getElementById("btn-snapshot");
const btnClearLog = document.getElementById("btn-clear-log");
const fpsRange    = document.getElementById("fps-range");
const fpsLabel    = document.getElementById("fps-label");
const toggleSound   = document.getElementById("toggle-sound");
const toggleAutosnap= document.getElementById("toggle-autosnap");

// ── State ─────────────────────────────────────────────────────
let stream       = null;
let sendTimer    = null;
let isSending    = false;
let frameCount   = 0;
let lastMotion   = false;
let motionEvents = 0;
let sessionStart = null;
let sessionTick  = null;
let audioCtx     = null;
let ratioHistory = new Array(CHART_POINTS).fill(0);
let autoSnapLast = false;

// ── Session timer ────────────────────────────────────────────
function startSessionTimer() {
  sessionStart = Date.now();
  sessionTick  = setInterval(() => {
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

// ── Audio alert ───────────────────────────────────────────────
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playBeep(freq = 880, duration = 0.18, type = "square") {
  try {
    ensureAudio();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (_) {}
}

// ── Chart ─────────────────────────────────────────────────────
function drawChart() {
  const W = ratioChart.parentElement.clientWidth - 32;
  const H = 80;
  ratioChart.width  = W;
  ratioChart.height = H;

  chartCtx.clearRect(0, 0, W, H);

  const grad = chartCtx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(56,189,248,0.35)");
  grad.addColorStop(1, "rgba(56,189,248,0.01)");

  const step = W / (CHART_POINTS - 1);
  const max  = Math.max(...ratioHistory, THRESHOLD_RATIO * 3, 0.01);

  // Filled area
  chartCtx.beginPath();
  ratioHistory.forEach((v, i) => {
    const x = i * step;
    const y = H - (v / max) * (H - 6);
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });
  chartCtx.lineTo((CHART_POINTS - 1) * step, H);
  chartCtx.lineTo(0, H);
  chartCtx.closePath();
  chartCtx.fillStyle = grad;
  chartCtx.fill();

  // Line
  chartCtx.beginPath();
  ratioHistory.forEach((v, i) => {
    const x = i * step;
    const y = H - (v / max) * (H - 6);
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });
  chartCtx.strokeStyle = "#38bdf8";
  chartCtx.lineWidth   = 1.8;
  chartCtx.lineJoin    = "round";
  chartCtx.stroke();

  // Threshold line
  const ty = H - (THRESHOLD_RATIO / max) * (H - 6);
  chartCtx.beginPath();
  chartCtx.setLineDash([4, 4]);
  chartCtx.moveTo(0, ty);
  chartCtx.lineTo(W, ty);
  chartCtx.strokeStyle = "rgba(239,68,68,0.6)";
  chartCtx.lineWidth   = 1.2;
  chartCtx.stroke();
  chartCtx.setLineDash([]);
}

// ── Snapshot ───────────────────────────────────────────────────
function takeSnapshot(label = "snapshot") {
  if (!stream) return;
  cCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  captureCanvas.toBlob((blob) => {
    if (!blob) return;
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toLocaleTimeString().replace(/:/g, "-");
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `motion_${ts}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`📸 Đã chụp ảnh (${label})`, "log-snap");
  }, "image/jpeg", 0.92);
}

// ── FPS slider ────────────────────────────────────────────────
fpsRange.addEventListener("input", () => {
  fpsLabel.textContent = fpsRange.value;
  if (sendTimer) restartTimer();
});

// ── Start ─────────────────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }, audio: false,
    });
    video.srcObject = stream;

    video.addEventListener("loadedmetadata", async () => {
      displayCanvas.width  = video.videoWidth;
      displayCanvas.height = video.videoHeight;
      overlayCanvas.width  = video.videoWidth;
      overlayCanvas.height = video.videoHeight;
      captureCanvas.width  = video.videoWidth;
      captureCanvas.height = video.videoHeight;

      await video.play();

      placeholder.style.display = "none";
      requestAnimationFrame(drawFrame);
      startSending();
      startSessionTimer();
    }, { once: true });

    btnStart.disabled    = true;
    btnStop.disabled     = false;
    btnReset.disabled    = false;
    btnSnapshot.disabled = false;
    setStatus("live");
    document.getElementById("cam-dot").classList.add("live");
    addLog("📷 Camera đã kết nối", "log-info");
  } catch (e) {
    addLog("❌ Không thể mở camera: " + e.message, "log-motion");
  }
});

// ── Stop ──────────────────────────────────────────────────────
btnStop.addEventListener("click", () => {
  stopAll();
  addLog("⏹ Đã dừng phiên", "log-info");
});

// ── Reset background ──────────────────────────────────────────
btnReset.addEventListener("click", async () => {
  await fetch(`/api/cameras/${CAMERA_ID}`, { method: "DELETE" });
  frameCount = 0;
  ratioHistory = new Array(CHART_POINTS).fill(0);
  document.getElementById("stat-frames").textContent = "0";
  document.getElementById("stat-warmup").textContent = WARMUP_FRAMES;
  addLog("🔄 Background đã reset — warm-up lại từ đầu", "log-warm");
});

// ── Snapshot button ───────────────────────────────────────────
btnSnapshot.addEventListener("click", () => takeSnapshot("manual"));

// ── Clear log button ──────────────────────────────────────────
btnClearLog.addEventListener("click", () => {
  const log = document.getElementById("log");
  log.innerHTML = '<div class="log-info">── Log đã xóa ──</div>';
});

// ── Draw video to display canvas ──────────────────────────────
function drawFrame() {
  if (!stream) return;
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    dCtx.drawImage(video, 0, 0, displayCanvas.width, displayCanvas.height);
  }
  requestAnimationFrame(drawFrame);
}

// ── Send frame to server ──────────────────────────────────────
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

  captureCanvas.toBlob(async (blob) => {
    if (!blob) { isSending = false; return; }

    const form = new FormData();
    form.append("file", blob, "frame.jpg");

    const t0 = performance.now();
    try {
      const res  = await fetch(`/api/cameras/${CAMERA_ID}/predict`, { method: "POST", body: form });
      const ping = Math.round(performance.now() - t0);
      const data = await res.json();
      updateUI(data, ping);
    } catch (_) {
      addLog("❌ Lỗi kết nối server", "log-motion");
    }

    isSending = false;
  }, "image/jpeg", 0.7);
}

// ── Update UI ─────────────────────────────────────────────────
function updateUI(data, ping) {
  frameCount       = data.frame_count;
  const ratio      = (data.foreground_ratio * 100).toFixed(2);
  const warmLeft   = Math.max(0, WARMUP_FRAMES - data.frame_count);
  const isMotion   = data.motion_detected && !data.warming_up;

  document.getElementById("stat-frames").textContent  = data.frame_count;
  document.getElementById("stat-warmup").textContent  = data.warming_up ? warmLeft : "✅ Done";
  document.getElementById("stat-ratio").textContent   = ratio + "%";
  document.getElementById("stat-pixels").textContent  = data.foreground_pixels.toLocaleString();
  document.getElementById("stat-ping").textContent    = ping + " ms";
  document.getElementById("stat-events").textContent  = motionEvents;

  // FG ratio bar
  const barPct = Math.min(data.foreground_ratio / (THRESHOLD_RATIO * 5), 1) * 100;
  document.getElementById("ratio-bar").style.width = barPct + "%";

  // Threshold marker position
  const thresholdPct = (THRESHOLD_RATIO / (THRESHOLD_RATIO * 5)) * 100;
  document.getElementById("threshold-marker").style.left = thresholdPct + "%";

  // Chart history
  ratioHistory.push(data.foreground_ratio);
  if (ratioHistory.length > CHART_POINTS) ratioHistory.shift();
  drawChart();

  // Motion status box
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

      // Flash border
      motionFlash.classList.add("active");
      setTimeout(() => motionFlash.classList.remove("active"), 500);

      // Sound alert
      if (toggleSound.checked) playBeep(880, 0.2, "square");

      // Auto snapshot
      if (toggleAutosnap.checked && !autoSnapLast) takeSnapshot("auto");
    }
  } else {
    box.innerHTML = `<div class="motion-icon">✅</div><div class="motion-text">Bình thường</div>`;
    box.className = "motion-indicator motion-off";
    if (lastMotion) addLog("✅ Không còn chuyển động", "log-clear");
  }

  autoSnapLast = isMotion;
  lastMotion   = isMotion;
}

// ── Log ───────────────────────────────────────────────────────
function addLog(msg, cls = "log-info") {
  const log = document.getElementById("log");
  const div = document.createElement("div");
  div.className   = cls;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 120) log.removeChild(log.firstChild);
}

// ── Status badge ──────────────────────────────────────────────
function setStatus(state) {
  const badge = document.getElementById("status-badge");
  if (state === "live") {
    badge.textContent = "🔴 LIVE";
    badge.className   = "badge live";
  } else {
    badge.textContent = "⏹ Chưa bắt đầu";
    badge.className   = "badge";
  }
}

// ── Cleanup ───────────────────────────────────────────────────
function stopAll() {
  clearInterval(sendTimer);
  sendTimer = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  btnStart.disabled    = false;
  btnStop.disabled     = true;
  btnReset.disabled    = true;
  btnSnapshot.disabled = true;
  setStatus("stopped");
  document.getElementById("cam-dot").classList.remove("live");
  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  stopSessionTimer();
  placeholder.style.display = "";
}

// ── Init chart on load ────────────────────────────────────────
drawChart();
window.addEventListener("resize", drawChart);
