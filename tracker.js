/* ============================================================
   TRACKER.JS — Event logging cho nghiên cứu engagement
   Dashboard BK-eLearning (Prototype 3) — Pham Xuan Lam
   ------------------------------------------------------------
   Ghi nhận: page_view, click (data-track), section dwell time,
   heartbeat, session end. Gửi về Supabase nếu được cấu hình;
   luôn buffer trong localStorage (xuất CSV: Ctrl+Shift+E).
   ============================================================ */

/* ====== 1. CẤU HÌNH — dán Web app URL từ Apps Script (xem apps-script.gs) ====== */
const GAS_URL = "https://script.google.com/macros/s/AKfycbx_TSeUza9JMXBZ_AGMKr-yo-3NcQC3Mk8gUkmTQzNEq39nuGCGfWNb6FNsMp1pLi6thA/exec";
const PROTOTYPE_VERSION = "P3-WS3-d2-mobile"; // ngày 2 (responsive). Ngày 1 đã thu dưới nhãn cũ.

/* ====== 2. State ====== */
const SESSION_ID = crypto.randomUUID();
const T0 = Date.now();
let participantId = localStorage.getItem("bk_participant") || null;
const BUFFER_KEY = "bk_events_buffer";

/* ====== 3. Core: ghi & gửi event ====== */
function logEvent(eventType, target, meta = {}) {
  const ev = {
    participant_id: participantId || "(pending)",
    session_id: SESSION_ID,
    prototype_version: PROTOTYPE_VERSION,
    event_type: eventType,
    target_component: target || null,
    metadata: meta,
    ts: new Date().toISOString(),
  };
  // buffer local (luôn luôn — kể cả khi có Supabase, để dự phòng)
  try {
    const buf = JSON.parse(localStorage.getItem(BUFFER_KEY) || "[]");
    buf.push(ev);
    localStorage.setItem(BUFFER_KEY, JSON.stringify(buf));
  } catch (e) { /* quota đầy thì bỏ qua */ }
  // gửi Google Sheet (Apps Script) nếu đã cấu hình
  if (GAS_URL) {
    // Content-Type text/plain → request "đơn giản", không bị chặn CORS preflight
    fetch(GAS_URL, {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(ev),
    }).catch(() => {});
  }
}

/* ====== 4. Consent gate ====== */
const overlay = document.getElementById("consentOverlay");
const app = document.getElementById("app");
const startBtn = document.getElementById("startBtn");
const pidInput = document.getElementById("participantId");
const ck = document.getElementById("consentCheck");

function gateCheck() {
  const ok = /^[A-Za-z0-9]{5,15}$/.test(pidInput.value.trim()); // MSSV: 5-15 ký tự chữ/số
  startBtn.disabled = !(ok && ck.checked);
}
if (participantId) {  // đã consent từ trước
  overlay.style.display = "none";
  logEvent("page_view", "dashboard", { returning: true });
} else {
  app.classList.add("blurred");
  pidInput.addEventListener("input", gateCheck);
  ck.addEventListener("change", gateCheck);
  startBtn.addEventListener("click", () => {
    participantId = pidInput.value.trim();
    localStorage.setItem("bk_participant", participantId);
    overlay.style.display = "none";
    app.classList.remove("blurred");
    logEvent("consent_given", "consent_modal");
    logEvent("page_view", "dashboard", { returning: false });
    if (window.loadContent) window.loadContent(participantId); // tải nội dung thật theo MSSV
  });
}

/* ====== 4b. Đăng xuất = đổi người dùng (cho máy dùng chung) ====== */
const logoutEl = document.querySelector('[data-track="logout"]');
if (logoutEl) logoutEl.addEventListener("click", (e) => {
  e.preventDefault();
  flushSession();
  logEvent("logout", "logout");
  localStorage.removeItem("bk_participant");
  setTimeout(() => location.reload(), 200); // SV tiếp theo nhập mã mới
});

/* ====== 5. Click tracking (mọi phần tử có data-track) ====== */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-track]");
  if (el) logEvent("click", el.dataset.track);
});

/* ====== 6. Search tracking (gõ xong 1.5s mới log, không log nội dung dài) ====== */
const searchBox = document.getElementById("searchBox");
if (searchBox) {
  let t;
  searchBox.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => logEvent("search", "search_box", { query_len: searchBox.value.length }), 1500);
  });
}

/* ====== 7. Section dwell time (IntersectionObserver) ====== */
const dwell = {}; // section -> tổng giây nhìn thấy
const visibleSince = {};
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    const name = en.target.dataset.section;
    if (en.isIntersecting) visibleSince[name] = Date.now();
    else if (visibleSince[name]) {
      dwell[name] = (dwell[name] || 0) + (Date.now() - visibleSince[name]) / 1000;
      delete visibleSince[name];
    }
  });
}, { threshold: 0.4 });
document.querySelectorAll("[data-section]").forEach((s) => io.observe(s));

/* ====== 8. Heartbeat mỗi 60s khi tab đang mở (60s để tiết kiệm quota Apps Script) ====== */
setInterval(() => {
  if (document.visibilityState === "visible" && participantId)
    logEvent("heartbeat", "page", { elapsed_s: Math.round((Date.now() - T0) / 1000) });
}, 60000);

/* ====== 9. Kết phiên: chốt dwell + duration ====== */
function flushSession() {
  Object.keys(visibleSince).forEach((name) => {
    dwell[name] = (dwell[name] || 0) + (Date.now() - visibleSince[name]) / 1000;
    delete visibleSince[name];
  });
  logEvent("session_end", "page", {
    duration_s: Math.round((Date.now() - T0) / 1000),
    dwell_s: Object.fromEntries(Object.entries(dwell).map(([k, v]) => [k, Math.round(v)])),
  });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSession();
});

/* ====== 10. Xuất CSV buffer (cho nghiên cứu viên): Ctrl+Shift+E ====== */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
    const buf = JSON.parse(localStorage.getItem(BUFFER_KEY) || "[]");
    if (!buf.length) return toast("Chưa có event nào trong buffer.");
    const cols = ["participant_id","session_id","prototype_version","event_type","target_component","ts","metadata"];
    const csv = [cols.join(",")].concat(buf.map(ev =>
      cols.map(c => `"${String(c === "metadata" ? JSON.stringify(ev[c]) : ev[c] ?? "").replace(/"/g, '""')}"`).join(",")
    )).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `events_${PROTOTYPE_VERSION}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast(`Đã xuất ${buf.length} events.`);
  }
});

/* ====== Toast helper ====== */
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}
