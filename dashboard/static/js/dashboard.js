const POLL_INTERVAL_MS = 5000;
const HISTORY_LIMIT = 100;
// Worker hien gui BPM moi 60s (xem --interval trong breathing_worker.py).
// Nguong nay PHAI lon hon chu ky gui cua worker, neu khong dashboard se
// bao "mat ket noi" mot cach gia tao giua 2 lan gui. Neu ban doi
// --interval sang gia tri khac 60, nho cap nhat lai so nay cho khop
// (vd interval=30 -> dat khoang 45000-50000).
const STALE_AFTER_MS = 90000; // 90s = 60s chu ky + 30s du phong tre mang

const LOW_THRESHOLD = 10;
const HIGH_THRESHOLD = 25;
const ALERT_LOG_MAX = 30;

const bpmValueEl = document.getElementById("bpm-value");
const breathStatusEl = document.getElementById("breath-status");
const breathStatusBadge = document.getElementById("breath-status-badge");
const bpmRingEl = document.getElementById("bpm-ring");
const lastUpdatedEl = document.getElementById("last-updated");
const lastSourceEl = document.getElementById("last-source");
const statusDotEl = document.getElementById("status-dot");
const statusTextEl = document.getElementById("status-text");
const statAvgEl = document.getElementById("stat-avg");
const statMinEl = document.getElementById("stat-min");
const statMaxEl = document.getElementById("stat-max");
const alertListEl = document.getElementById("alert-list");
const alertCountEl = document.getElementById("alert-count");
const topClockEl = document.getElementById("top-clock");

let chart = null;

// ---- Clock ----
function updateClock() {
  const now = new Date();
  topClockEl.textContent = now.toLocaleTimeString("vi-VN", { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// ---- Helpers ----

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

function setStatus(online) {
  statusDotEl.classList.toggle("online", online);
  statusDotEl.classList.toggle("offline", !online);
  statusTextEl.textContent = online ? "Đang giám sát" : "Mất kết nối";
}

// ---- Alert Log ----

let alertLog = [];

function addAlert(record) {
  const bpm = Number(record.bpm);
  const timestamp = record.recorded_at || record.created_at;
  let severity, msg;

  if (bpm < LOW_THRESHOLD) {
    severity = "critical";
    msg = "Nhịp thở quá thấp";
  } else if (bpm > HIGH_THRESHOLD) {
    severity = "warning";
    msg = "Nhịp thở quá cao";
  } else {
    severity = "normal";
    msg = "Bình thường";
  }

  alertLog.unshift({ time: formatTime(timestamp), bpm, severity, msg });
  if (alertLog.length > ALERT_LOG_MAX) alertLog.length = ALERT_LOG_MAX;
  renderAlertLog();
}

function renderAlertLog() {
  if (!alertListEl) return;
  if (alertLog.length === 0) {
    alertListEl.innerHTML = '<li class="alert-empty">Chưa có dữ liệu</li>';
    if (alertCountEl) alertCountEl.textContent = "0";
    return;
  }

  const abnormalCount = alertLog.filter(a => a.severity !== "normal").length;
  if (alertCountEl) alertCountEl.textContent = abnormalCount > 0 ? `${abnormalCount} cảnh báo` : "Tất cả bình thường";

  alertListEl.innerHTML = alertLog.map(a =>
    `<li class="alert-item alert-${a.severity}">
       <span class="alert-dot"></span>
       <span class="alert-time">${a.time}</span>
       <span class="alert-msg">${a.msg}</span>
       <span class="alert-bpm">${a.bpm.toFixed(1)}</span>
     </li>`
  ).join("");
}

// ---- Update Latest ----

function updateLatest(record) {
  if (!record) {
    bpmValueEl.textContent = "--";
    if (breathStatusEl) {
      breathStatusEl.textContent = "—";
    }
    if (breathStatusBadge) {
      breathStatusBadge.className = "status-badge normal";
    }
    if (bpmRingEl) bpmRingEl.classList.remove("warning");
    lastUpdatedEl.textContent = "—";
    lastSourceEl.textContent = "—";
    setStatus(false);
    return;
  }

  const timestamp = record.recorded_at || record.created_at;

  bpmValueEl.textContent = Number(record.bpm).toFixed(1);
  lastUpdatedEl.textContent = formatTime(timestamp);
  let sourceText = record.source || "—";
  if (sourceText === "camera_ai") sourceText = "Camera real-time";
  lastSourceEl.textContent = sourceText;

  const isAbnormal = record.bpm < LOW_THRESHOLD || record.bpm > HIGH_THRESHOLD;
  bpmValueEl.classList.toggle("warning", isAbnormal);

  if (bpmRingEl) bpmRingEl.classList.toggle("warning", isAbnormal);

  if (breathStatusEl && breathStatusBadge) {
    if (isAbnormal) {
      breathStatusEl.textContent = "Bất thường";
      breathStatusBadge.className = "status-badge abnormal";
    } else {
      breathStatusEl.textContent = "Bình thường";
      breathStatusBadge.className = "status-badge normal";
    }
  }

  const ageMs = Date.now() - new Date(timestamp).getTime();
  setStatus(ageMs <= STALE_AFTER_MS);
}

// Tách riêng try/catch cho updateStats và renderChart -- để nếu 1 trong 2
// bị lỗi thì cái còn lại vẫn chạy được, không "rớt" theo nhau.

function updateStats(records) {
  try {
    if (!records || !records.length) {
      statAvgEl.textContent = "--";
      statMinEl.textContent = "--";
      statMaxEl.textContent = "--";
      return;
    }
    const values = records.map((r) => Number(r.bpm)).filter((v) => !Number.isNaN(v));
    if (!values.length) {
      statAvgEl.textContent = "--";
      statMinEl.textContent = "--";
      statMaxEl.textContent = "--";
      return;
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    statAvgEl.innerHTML = avg.toFixed(1) + '<span class="stat-unit"> BPM</span>';
    statMinEl.innerHTML = Math.min(...values).toFixed(1) + '<span class="stat-unit"> BPM</span>';
    statMaxEl.innerHTML = Math.max(...values).toFixed(1) + '<span class="stat-unit"> BPM</span>';
  } catch (err) {
    console.error("[dashboard] Lỗi khi tính avg/min/max:", err);
  }
}

function renderChart(records) {
  try {
    const ordered = [...records].reverse();
    const labels = ordered.map((r) => formatTime(r.recorded_at || r.created_at));
    const values = ordered.map((r) => Number(r.bpm));

    // Normal range band data (10-20 BPM)
    const normalHigh = values.map(() => HIGH_THRESHOLD);
    const normalLow = values.map(() => LOW_THRESHOLD);

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = normalHigh;
      chart.data.datasets[1].data = normalLow;
      chart.data.datasets[2].data = values;
      chart.update();
      return;
    }

    const canvas = document.getElementById("history-chart");
    if (!canvas) {
      console.error("[dashboard] Không tìm thấy canvas #history-chart trong DOM");
      return;
    }
    if (typeof Chart === "undefined") {
      console.error("[dashboard] Chart.js chưa được load (kiểm tra mạng/CDN)");
      return;
    }

    const ctx = canvas.getContext("2d");
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Ngưỡng trên",
            data: normalHigh,
            borderColor: "transparent",
            backgroundColor: "rgba(0, 166, 138, 0.08)",
            fill: "+1",
            pointRadius: 0,
            pointHitRadius: 0,
            borderWidth: 0,
            order: 2,
          },
          {
            label: "Ngưỡng dưới",
            data: normalLow,
            borderColor: "rgba(0, 166, 138, 0.2)",
            borderDash: [4, 4],
            backgroundColor: "transparent",
            fill: false,
            pointRadius: 0,
            pointHitRadius: 0,
            borderWidth: 1,
            order: 3,
          },
          {
            label: "BPM",
            data: values,
            borderColor: "#00A68A",
            backgroundColor: "rgba(0, 166, 138, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: "#00A68A",
            pointHoverBorderColor: "#FFFFFF",
            pointHoverBorderWidth: 2,
            pointHitRadius: 12,
            borderWidth: 2,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: {
          mode: "nearest",
          axis: "x",
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            titleColor: "#4B5563",
            bodyColor: "#1F2937",
            borderColor: "rgba(0, 0, 0, 0.08)",
            borderWidth: 1,
            titleFont: { family: "Inter", size: 11 },
            bodyFont: { family: "JetBrains Mono", size: 12 },
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            filter: (item) => item.datasetIndex === 2,
            callbacks: {
              title: (items) => `${items[0]?.label ?? ""}`,
              label: (item) => `BPM: ${Number(item.parsed.y).toFixed(1)}`,
            },
          },
          zoom: {
            pan: {
              enabled: true,
              mode: "x",
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "x",
            },
            limits: {
              x: { minRange: 5 },
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(0, 0, 0, 0.04)" },
            ticks: {
              maxTicksLimit: 8,
              color: "#9CA3AF",
              font: { family: "JetBrains Mono", size: 10 },
            },
            border: { color: "rgba(0, 0, 0, 0.08)" },
          },
          y: {
            grid: { color: "rgba(0, 0, 0, 0.04)" },
            ticks: {
              color: "#9CA3AF",
              font: { family: "JetBrains Mono", size: 10 },
            },
            border: { color: "rgba(0, 0, 0, 0.08)" },
            suggestedMin: 5,
            suggestedMax: 30,
          },
        },
      },
    });

    canvas.addEventListener("dblclick", () => {
      if (chart) chart.resetZoom();
    });
  } catch (err) {
    console.error("[dashboard] Lỗi khi vẽ chart lịch sử:", err);
  }
}

// ===========================
// Realtime — Server-Sent Events
// ===========================

// Giữ lịch sử trong bộ nhớ, tránh gọi lại /api/history mỗi lần có bản ghi mới
let historyRecords = [];

async function loadHistory() {
  try {
    const res = await fetch(`/api/history?limit=${HISTORY_LIMIT}`);
    if (!res.ok) {
      console.error(`[dashboard] /api/history trả lỗi HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    historyRecords = Array.isArray(data) ? data : [];
    console.log(`[dashboard] Tải lịch sử: ${historyRecords.length} bản ghi`);
    renderChart(historyRecords);
    updateStats(historyRecords);
    if (historyRecords.length > 0) {
      updateLatest(historyRecords[0]); // phần tử đầu là mới nhất (đã sort desc)
    }

    // Build alert log from history
    alertLog = [];
    historyRecords.forEach(r => addAlertSilent(r));
    renderAlertLog();
  } catch (err) {
    console.error("[dashboard] Lỗi khi tải lịch sử:", err);
  }
}

// Add to alert log without re-rendering (for batch load)
function addAlertSilent(record) {
  const bpm = Number(record.bpm);
  const timestamp = record.recorded_at || record.created_at;
  let severity, msg;

  if (bpm < LOW_THRESHOLD) {
    severity = "critical";
    msg = "Nhịp thở quá thấp";
  } else if (bpm > HIGH_THRESHOLD) {
    severity = "warning";
    msg = "Nhịp thở quá cao";
  } else {
    severity = "normal";
    msg = "Bình thường";
  }

  alertLog.push({ time: formatTime(timestamp), bpm, severity, msg });
  if (alertLog.length > ALERT_LOG_MAX) alertLog.length = ALERT_LOG_MAX;
}

function onNewRecord(record) {
  updateLatest(record);
  addAlert(record);

  // Thêm vào đầu mảng, giữ tối đa HISTORY_LIMIT phần tử
  historyRecords.unshift(record);
  if (historyRecords.length > HISTORY_LIMIT) {
    historyRecords.length = HISTORY_LIMIT;
  }
  renderChart(historyRecords);
  updateStats(historyRecords);
}

function connectSSE() {
  const es = new EventSource("/api/stream");

  es.addEventListener("connected", () => {
    console.log("[dashboard] SSE kết nối thành công, đang tải lịch sử...");
    setStatus(true);
    loadHistory();
  });

  es.addEventListener("update", (e) => {
    try {
      const { path, data } = JSON.parse(e.data);
      if (path === "/") {
        // Sự kiện đầu tiên: Firebase gửi toàn bộ collection — bỏ qua,
        // lịch sử đã được tải qua loadHistory() ở sự kiện "connected".
        return;
      }
      // path dạng "/<push_key>" — đây là bản ghi mới nhất
      if (data && typeof data === "object") {
        const record = { ...data, id: path.replace("/", "") };
        if (record.created_at && !record.recorded_at) {
          record.recorded_at = record.created_at;
        }
        console.log(`[dashboard] Realtime cập nhật BPM: ${record.bpm}`);
        onNewRecord(record);
      }
    } catch (err) {
      console.error("[dashboard] Lỗi parse sự kiện SSE:", err);
    }
  });

  es.addEventListener("heartbeat", () => {
    // Giữ kết nối sống — không cần xử lý
  });

  es.onerror = () => {
    setStatus(false);
    console.warn("[dashboard] SSE mất kết nối, trình duyệt sẽ tự thử lại...");
  };
}

const resetZoomBtn = document.getElementById("reset-zoom-btn");
if (resetZoomBtn) {
  resetZoomBtn.addEventListener("click", () => {
    if (chart) chart.resetZoom();
  });
}

// Khởi động — thay thế hoàn toàn setInterval polling
connectSSE();


