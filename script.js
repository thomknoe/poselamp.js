/* =========================================================
   GLOBAL STATE
========================================================= */

let mqttClient = null;
let mqttConnected = false;
let deviceOnline = false;

let uprightDelta = null;
let slouchDelta = null;
let lastDelta = null;

let selectedMode = "NORMAL"; // Default brightness
let selectedUprightGradient = 5; // Default to Dawn
let selectedSlouchGradient = 0; // Default first gradient

let sessionActive = false;
let sessionStartTime = null;
let postureScore = 100;

let lastPostureCode = null;
let lastPostureCandidate = null;
let postureStableFrames = 0;

// Pose variables
let video,
  bodyPose,
  connections = [],
  poses = [];
let canvasObj = null;

/* TRENDLINE DATA */
let trendData = [];
let lastTrendSampleTime = 0; // ms timestamp for sampling

/* SPECIAL MODES TIMERS */
let mobilityTimeout = null;
let partyTimeout = null;

/* =========================================================
   MQTT HELPERS
========================================================= */

function updateMQTTDisplay(connected) {
  const dot = document.getElementById("mqttDot");
  const status = document.getElementById("mqttStatus");

  mqttConnected = connected;

  if (dot) {
    dot.className = connected
      ? "status-dot connected"
      : "status-dot disconnected";
  }
  if (status) {
    status.innerText = connected ? "Connected" : "Disconnected";
  }
}

function safePublish(topic, message) {
  if (!mqttClient || !mqttConnected) return;
  mqttClient.publish(topic, String(message));
}

function connectMQTT() {
  mqttClient = mqtt.connect("wss://test.mosquitto.org:8081");

  mqttClient.on("connect", () => {
    updateMQTTDisplay(true);
    mqttClient.subscribe("esp32/status");
  });

  mqttClient.on("reconnect", () => updateMQTTDisplay(false));
  mqttClient.on("error", () => updateMQTTDisplay(false));

  mqttClient.on("message", (topic, payload) => {
    if (topic === "esp32/status") {
      const msg = payload.toString();
      const [state, ip] = msg.split("|");

      if (state === "ONLINE") {
        deviceOnline = true;
        document.getElementById("deviceIP").innerText = ip;
        document.getElementById("toStep2").disabled = false;
      }
    }
  });
}

/* =========================================================
   SCREEN NAVIGATION & CANVAS RE-PARENTING
========================================================= */

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active-screen"));
  document.getElementById(id).classList.add("active-screen");

  if (canvasObj) {
    if (id === "screen2") {
      canvasObj.parent("videoContainer");
    } else if (id === "dashboard") {
      canvasObj.parent("dashboardVideoContainer");
    }
  }

  if (id === "screen3" || id === "dashboard") {
    syncGradientSelections();
  }
}

/* =========================================================
   CALIBRATION HELPERS
========================================================= */

function updateCalUI() {
  if (uprightDelta !== null) {
    document.getElementById("uprightDeltaVal").innerText =
      uprightDelta.toFixed(1);
  }
  if (slouchDelta !== null) {
    document.getElementById("slouchDeltaVal").innerText =
      slouchDelta.toFixed(1);
  }

  document.getElementById("toStep3").disabled = !(
    uprightDelta !== null && slouchDelta !== null
  );
}

function enableFinishIfReady() {
  // Gradients always have defaults; mode is optional
  document.getElementById("finishSetup").disabled = false;
}

// Gradient color definitions (matching ESP-32)
const GRADIENT_COLORS = {
  UPRIGHT: [
    { a: "rgb(80, 160, 100)", b: "rgb(140, 220, 160)", name: "Sage" },
    { a: "rgb(60, 160, 200)", b: "rgb(40, 200, 240)", name: "Sky" },
    { a: "rgb(160, 140, 200)", b: "rgb(200, 160, 220)", name: "Lavender" },
    { a: "rgb(180, 200, 220)", b: "rgb(160, 190, 210)", name: "Pearl" },
    { a: "rgb(100, 200, 160)", b: "rgb(140, 240, 190)", name: "Mint" },
    { a: "rgb(240, 180, 140)", b: "rgb(250, 210, 180)", name: "Dawn" },
  ],
  SLOUCH: [
    { a: "rgb(255, 100, 40)", b: "rgb(255, 50, 70)", name: "Ember" },
    { a: "rgb(255, 120, 80)", b: "rgb(255, 70, 120)", name: "Sunset" },
    { a: "rgb(255, 150, 30)", b: "rgb(255, 110, 50)", name: "Amber" },
    { a: "rgb(255, 90, 110)", b: "rgb(255, 120, 150)", name: "Rose" },
    { a: "rgb(255, 100, 70)", b: "rgb(255, 150, 120)", name: "Coral" },
    { a: "rgb(255, 70, 50)", b: "rgb(255, 130, 70)", name: "Flame" },
  ],
};

function updateFooterSwatches() {
  const uprightSwatch = document.getElementById("footerUprightSwatch");
  const slouchSwatch = document.getElementById("footerSlouchSwatch");

  if (uprightSwatch && GRADIENT_COLORS.UPRIGHT[selectedUprightGradient]) {
    const grad = GRADIENT_COLORS.UPRIGHT[selectedUprightGradient];
    uprightSwatch.style.background = `linear-gradient(to right, ${grad.a}, ${grad.b})`;
    uprightSwatch.title = `Upright: ${grad.name}`;
  }

  if (slouchSwatch && GRADIENT_COLORS.SLOUCH[selectedSlouchGradient]) {
    const grad = GRADIENT_COLORS.SLOUCH[selectedSlouchGradient];
    slouchSwatch.style.background = `linear-gradient(to right, ${grad.a}, ${grad.b})`;
    slouchSwatch.title = `Slouch: ${grad.name}`;
  }
}

function selectGradient(posture, index) {
  if (posture === "UPRIGHT") {
    selectedUprightGradient = index;
    document
      .querySelectorAll('[data-posture="UPRIGHT"]')
      .forEach((el) => el.classList.remove("selected"));
    document
      .querySelectorAll(`[data-posture="UPRIGHT"][data-index="${index}"]`)
      .forEach((el) => el.classList.add("selected"));

    safePublish("esp32/gradient", `UPRIGHT:${index}:INSTANT`);
    updateFooterSwatches();
  } else if (posture === "SLOUCH") {
    selectedSlouchGradient = index;
    document
      .querySelectorAll('[data-posture="SLOUCH"]')
      .forEach((el) => el.classList.remove("selected"));
    document
      .querySelectorAll(`[data-posture="SLOUCH"][data-index="${index}"]`)
      .forEach((el) => el.classList.add("selected"));

    safePublish("esp32/gradient", `SLOUCH:${index}:INSTANT`);
    updateFooterSwatches();
  }
}

function syncGradientSelections() {
  document
    .querySelectorAll(
      `[data-posture="UPRIGHT"][data-index="${selectedUprightGradient}"]`
    )
    .forEach((el) => el.classList.add("selected"));

  document
    .querySelectorAll(
      `[data-posture="SLOUCH"][data-index="${selectedSlouchGradient}"]`
    )
    .forEach((el) => el.classList.add("selected"));

  updateFooterSwatches();
}

/* =========================================================
   SESSION TIMER
========================================================= */

function updateSessionDuration() {
  const durationEl = document.getElementById("sessionDuration");
  if (!sessionActive || !sessionStartTime) {
    durationEl.innerText = "00:00";
    return;
  }
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  durationEl.innerText = `${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;
}

/* =========================================================
   POSTURE SCORE
========================================================= */

function updatePostureScore(code) {
  if (!sessionActive) return;

  if (code === "S") {
    postureScore = Math.max(0, postureScore - 2);
  } else if (code === "U") {
    postureScore = Math.min(100, postureScore + 0.5);
  }

  const scoreEl = document.getElementById("postureScore");
  scoreEl.innerText = Math.round(postureScore);
  scoreEl.className = "stat-value";

  if (postureScore >= 80) {
    scoreEl.classList.add("score-good");
  } else if (postureScore >= 50) {
    scoreEl.classList.add("score-medium");
  } else {
    scoreEl.classList.add("score-low");
  }
}

/* =========================================================
   TRENDLINE GRAPH (FULL SESSION, COMPRESSED)
========================================================= */

/* --- Trendline with real-time smoothing & dynamic density --- */

let smoothedDelta = null;

function addTrendPoint(delta) {
  if (!sessionActive) return;

  const now = Date.now();

  // Real-time sampling (20 Hz pace)
  if (now - lastTrendSampleTime < 50) return;
  lastTrendSampleTime = now;

  // Exponential smoothing
  if (smoothedDelta === null) smoothedDelta = delta;
  smoothedDelta = smoothedDelta * 0.85 + delta * 0.15;

  trendData.push({ value: smoothedDelta });

  drawTrendline();
}

function drawTrendline() {
  const canvas = document.getElementById("trendCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (trendData.length < 2) {
    // Draw empty state
    ctx.fillStyle = "#8e8e93";
    ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      "Posture data will appear here",
      canvas.width / 2,
      canvas.height / 2
    );
    return;
  }

  const maxDelta = Math.max(...trendData.map((p) => p.value), 40);
  const minDelta = Math.min(...trendData.map((p) => p.value), -40);
  const range = maxDelta - minDelta || 1;
  const padding = 20;

  // Draw grid lines and tick marks
  ctx.strokeStyle = "#e5e5ea";
  ctx.lineWidth = 0.5;

  // Horizontal grid lines (5 lines) with tick marks
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i * (canvas.height - padding * 2)) / 4;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(canvas.width - padding, y);
    ctx.stroke();

    // Y-axis tick marks
    ctx.beginPath();
    ctx.moveTo(padding - 4, y);
    ctx.lineTo(padding, y);
    ctx.stroke();

    // Y-axis labels
    const value = maxDelta - (i * range) / 4;
    ctx.fillStyle = "#8e8e93";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(value.toFixed(0), padding - 8, y + 3);
  }

  // Vertical grid lines (time markers) with tick marks
  const timeMarkers = 6;
  for (let i = 0; i <= timeMarkers; i++) {
    const x = padding + (i * (canvas.width - padding * 2)) / timeMarkers;
    ctx.beginPath();
    ctx.moveTo(x, canvas.height - padding);
    ctx.lineTo(x, canvas.height - padding + 4);
    ctx.stroke();
  }

  // X-axis label
  ctx.fillStyle = "#8e8e93";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Time", canvas.width / 2, canvas.height - 4);

  // Y-axis label
  ctx.save();
  ctx.translate(12, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Delta (px)", 0, 0);
  ctx.restore();

  // Draw zero line (threshold indicator)
  const zeroY =
    canvas.height -
    padding -
    ((0 - minDelta) / range) * (canvas.height - padding * 2);
  ctx.strokeStyle = "#d1d1d6";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(canvas.width, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw trendline
  const step = (canvas.width - padding * 2) / Math.max(trendData.length - 1, 1);

  ctx.beginPath();
  ctx.strokeStyle = "#007AFF";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  trendData.forEach((pt, i) => {
    const x = padding + i * step;
    const y =
      canvas.height -
      padding -
      ((pt.value - minDelta) / range) * (canvas.height - padding * 2);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  // Draw area under curve
  if (trendData.length > 0) {
    const firstY =
      canvas.height -
      padding -
      ((trendData[0].value - minDelta) / range) * (canvas.height - padding * 2);
    const lastY =
      canvas.height -
      padding -
      ((trendData[trendData.length - 1].value - minDelta) / range) *
        (canvas.height - padding * 2);

    ctx.fillStyle = "rgba(0, 122, 255, 0.1)";
    ctx.beginPath();
    ctx.moveTo(padding, canvas.height - padding);
    ctx.lineTo(padding, firstY);
    trendData.forEach((pt, i) => {
      const x = padding + i * step;
      const y =
        canvas.height -
        padding -
        ((pt.value - minDelta) / range) * (canvas.height - padding * 2);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(
      padding + (trendData.length - 1) * step,
      canvas.height - padding
    );
    ctx.closePath();
    ctx.fill();
  }
}

/* =========================================================
   POSTURE OUTPUT + MQTT
========================================================= */

function applyPosture(code) {
  const box = document.getElementById("postureBox");

  const label = code === "U" ? "Upright" : "Slouched";

  if (box) {
    box.innerText = label;
    box.className = "status-tile " + (code === "S" ? "bad" : "good");
  }

  const calibStatus = document.getElementById("calibStatus");
  if (calibStatus && calibStatus.offsetParent !== null) {
    calibStatus.innerText = "Current posture: " + label;
  }

  if (!sessionActive) return;

  if (code !== lastPostureCandidate) {
    lastPostureCandidate = code;
    postureStableFrames = 0;
  } else {
    postureStableFrames++;
  }

  if (postureStableFrames >= 5 && code !== lastPostureCode) {
    lastPostureCode = code;

    safePublish("esp32/posture", code);

    if (code === "U") {
      safePublish("esp32/mode", "MODE_UPRIGHT");
    } else if (code === "S") {
      safePublish("esp32/mode", "MODE_SLOUCH");
    }

    updatePostureScore(code);
  }
}

/* =========================================================
   POSTURE CALCULATION
========================================================= */

function computePosture(pose) {
  if (!pose || !pose.keypoints) return;

  const kpByName = {};
  pose.keypoints.forEach((kp) => {
    if (kp.name) kpByName[kp.name] = kp;
  });

  const nose = kpByName["nose"] || pose.keypoints[0];
  const leftShoulder = kpByName["left_shoulder"] || pose.keypoints[5];
  const rightShoulder = kpByName["right_shoulder"] || pose.keypoints[6];

  if (!nose || !leftShoulder || !rightShoulder) return;

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const delta = nose.y - shoulderY;
  lastDelta = delta;

  document.getElementById("noseVal").innerText = nose.y.toFixed(1);
  document.getElementById("shoulderVal").innerText = shoulderY.toFixed(1);
  document.getElementById("deltaVal").innerText = delta.toFixed(1);

  addTrendPoint(delta);

  let code;
  if (uprightDelta !== null && slouchDelta !== null) {
    code = delta >= slouchDelta ? "S" : "U";
  } else {
    code = delta > -100 ? "S" : "U";
  }

  applyPosture(code);
}

/* =========================================================
   ML5 + P5 SETUP (landmarks only)
========================================================= */

function preload() {
  bodyPose = ml5.bodyPose();
}

function setup() {
  canvasObj = createCanvas(640, 480);
  canvasObj.parent("videoContainer");

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  bodyPose.detectStart(video, gotPoses);
  connections = bodyPose.getSkeleton();
}

function gotPoses(results) {
  poses = results;
}

function draw() {
  if (!video) return;
  image(video, 0, 0, width, height);

  if (!poses.length) return;

  const pose = poses[0];

  stroke(255, 0, 0);
  strokeWeight(2);
  noFill();
  for (let j = 0; j < connections.length; j++) {
    const a = pose.keypoints[connections[j][0]];
    const b = pose.keypoints[connections[j][1]];
    if (a.confidence > 0.1 && b.confidence > 0.1) {
      line(a.x, a.y, b.x, b.y);
    }
  }

  fill(0, 255, 0);
  noStroke();
  pose.keypoints.forEach((kp) => {
    if (kp.confidence > 0.1) {
      circle(kp.x, kp.y, 10);
    }
  });

  computePosture(pose);
}

/* =========================================================
   SPECIAL MODE HELPERS (Mobility & Party)
========================================================= */

function restorePostureMode() {
  // After special mode, return to posture-based mode
  if (lastPostureCode === "S") {
    safePublish("esp32/mode", "MODE_SLOUCH");
  } else {
    safePublish("esp32/mode", "MODE_UPRIGHT");
  }
}

/* =========================================================
   EVENT LISTENERS
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  /* STEP 1 */
  document.getElementById("connectMQTT").onclick = connectMQTT;
  document.getElementById("pingDevice").onclick = () =>
    safePublish("esp32/ping", "PING");
  document.getElementById("toStep2").onclick = () => showScreen("screen2");

  /* STEP 2 */
  const uprightBtn = document.getElementById("setUpright");
  const slouchBtn = document.getElementById("setSlouch");

  uprightBtn.onclick = () => {
    if (lastDelta == null) return;
    uprightDelta = lastDelta;
    uprightBtn.classList.add("selected");
    updateCalUI();
  };

  slouchBtn.onclick = () => {
    if (lastDelta == null) return;
    slouchDelta = lastDelta;
    slouchBtn.classList.add("selected");
    updateCalUI();
  };

  document.getElementById("backTo1").onclick = () => showScreen("screen1");
  document.getElementById("toStep3").onclick = () => showScreen("screen3");

  /* STEP 3 */
  document.querySelectorAll(".modeBtn").forEach((btn) => {
    btn.onclick = () => {
      selectedMode = btn.dataset.mode;
      document
        .querySelectorAll(".modeBtn")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      safePublish("esp32/brightness", selectedMode);
      enableFinishIfReady();
    };
  });

  // Default mode selection
  const defaultModeBtn = document.querySelector('.modeBtn[data-mode="NORMAL"]');
  if (defaultModeBtn) defaultModeBtn.classList.add("selected");

  // Gradient selection in step 3
  document.querySelectorAll(".gradient-option").forEach((option) => {
    option.onclick = () => {
      const posture = option.dataset.posture;
      const index = parseInt(option.dataset.index, 10);
      selectGradient(posture, index);
      enableFinishIfReady();
    };
  });

  // Sync default gradient selections
  syncGradientSelections();

  document.getElementById("backTo2").onclick = () => showScreen("screen2");
  document.getElementById("finishSetup").onclick = () => {
    safePublish("esp32/gradient", `UPRIGHT:${selectedUprightGradient}:INSTANT`);
    safePublish("esp32/gradient", `SLOUCH:${selectedSlouchGradient}:INSTANT`);
    safePublish("esp32/brightness", selectedMode || "NORMAL");
    showScreen("dashboard");
  };

  /* DASHBOARD */
  const sessionToggle = document.getElementById("sessionToggle");

  sessionToggle.onclick = () => {
    sessionActive = !sessionActive;

    if (sessionActive) {
      sessionToggle.innerText = "Session On";
      sessionToggle.classList.remove("off");
      sessionToggle.classList.add("on");

      sessionStartTime = Date.now();
      postureScore = 100;

      // Reset trendline for new session
      trendData = [];
      lastTrendSampleTime = 0;
      drawTrendline();

      updatePostureScore("U");
    } else {
      sessionToggle.innerText = "Session Off";
      sessionToggle.classList.add("off");
      sessionToggle.classList.remove("on");

      sessionStartTime = null;

      // Clear trend for ended session
      trendData = [];
      lastTrendSampleTime = 0;
      drawTrendline();

      safePublish("esp32/mode", "MODE_UPRIGHT");
    }
  };

  // Dashboard gradient selection (mini tiles in modal)
  document.querySelectorAll(".gradient-mini").forEach((mini) => {
    mini.onclick = () => {
      const posture = mini.dataset.posture;
      const index = parseInt(mini.dataset.index, 10);
      selectGradient(posture, index);
    };
  });

  // Modal functionality
  const colorModal = document.getElementById("colorModal");
  const selectColorsBtn = document.getElementById("selectColorsBtn");
  const closeModal = document.getElementById("closeModal");

  selectColorsBtn.onclick = () => {
    colorModal.classList.add("active");
    syncGradientSelections();
  };

  closeModal.onclick = () => {
    colorModal.classList.remove("active");
  };

  colorModal.onclick = (e) => {
    if (e.target === colorModal) {
      colorModal.classList.remove("active");
    }
  };

  // Modal gradient selection
  document
    .querySelectorAll(
      "#modalUprightGradients .gradient-mini, #modalSlouchGradients .gradient-mini"
    )
    .forEach((mini) => {
      mini.onclick = () => {
        const posture = mini.dataset.posture;
        const index = parseInt(mini.dataset.index, 10);
        selectGradient(posture, index);
      };
    });

  /* Mobility Drill and Party Mode (10-second special modes) */

  document.getElementById("mobilityBtn").onclick = () => {
    // Cancel any previous timers
    if (mobilityTimeout) clearTimeout(mobilityTimeout);

    // Trigger 10s mobility mode (ESP handles flashing)
    safePublish("esp32/mode", "MODE_MOBILITY");

    mobilityTimeout = setTimeout(() => {
      restorePostureMode();
    }, 10000);
  };

  document.getElementById("partyBtn").onclick = () => {
    if (partyTimeout) clearTimeout(partyTimeout);

    // Trigger 10s party mode (ESP handles rainbow gradient)
    safePublish("esp32/mode", "MODE_PARTY");

    partyTimeout = setTimeout(() => {
      restorePostureMode();
    }, 10000);
  };

  // Update session timer every second
  setInterval(updateSessionDuration, 1000);

  // Initialize footer swatches on page load
  updateFooterSwatches();
});
