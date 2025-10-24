// frontend/manage.js

// Use backend on 5000 if the page is served from a different port (like 3002 or file://)
const API = (location.port === "5000") ? "/api" : "http://localhost:5000/api";

const roomIdInput = document.getElementById("roomId");
const bookingCodeInput = document.getElementById("bookingCode");
const extraMinutesInput = document.getElementById("extraMinutes");
const extendBtn = document.getElementById("extendBtn");
const releaseBtn = document.getElementById("releaseBtn");
const resultEl = document.getElementById("result");

function show(msg, ok = true) {
  resultEl.textContent = msg;
  resultEl.style.color = ok ? "#006400" : "#dc3545";
}

function int(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : NaN;
}

function prefillFromURL() {
  const params = new URLSearchParams(location.search);
  const rid = params.get("roomId") || params.get("id");
  if (rid) roomIdInput.value = rid;

  // Prefill booking code from localStorage if we have it
  const idNum = int(rid);
  const stored = idNum ? localStorage.getItem(`bookingCode:${idNum}`) : null;
  if (stored) bookingCodeInput.value = stored;
}

function isValidCode(code) {
  return /^[a-f0-9]{8}$/i.test(code);
}

function formatTime(ms) {
  return new Date(ms).toLocaleString();
}

// Helper that guarantees we hit JSON (better error if we hit HTML)
async function apiPost(path, body) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!contentType.includes("application/json")) {
    // You likely hit 127.0.0.1:3002 or a non-API route returning HTML
    throw new Error(`Unexpected response from ${url} (status ${res.status}). Starts with: ${text.slice(0, 80)}`);
  }

  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Invalid JSON from ${url}. Starts with: ${text.slice(0, 80)}`);
  }

  if (!res.ok) {
    throw new Error(data?.message || `Error ${res.status}`);
  }
  return data;
}

async function extendBooking() {
  const roomId = int(roomIdInput.value);
  const bookingCode = bookingCodeInput.value.trim();
  const extraMinutes = int(extraMinutesInput.value);

  if (!roomId) return show("Please enter a valid Room ID.", false);
  if (!bookingCode || !isValidCode(bookingCode)) {
    return show("Please enter a valid 8-character booking code.", false);
  }
  if (!extraMinutes || extraMinutes <= 0) {
    return show("Please enter minutes to extend (positive number).", false);
  }

  extendBtn.disabled = true;
  show("Extending booking...");

  try {
    const data = await apiPost(`/room/${roomId}/extend`, { bookingCode, extraMinutes });

    // Persist code for convenience
    localStorage.setItem(`bookingCode:${roomId}`, bookingCode);

    const endTime = data?.room?.endTime;
    const endText = endTime ? ` New end time: ${formatTime(endTime)}.` : "";
    show(`${data.message}.${endText}`, true);
  } catch (e) {
    show(e.message || "Could not extend booking.", false);
  } finally {
    extendBtn.disabled = false;
  }
}

async function releaseBooking() {
  const roomId = int(roomIdInput.value);
  const bookingCode = bookingCodeInput.value.trim();

  if (!roomId) return show("Please enter a valid Room ID.", false);
  if (!bookingCode || !isValidCode(bookingCode)) {
    return show("Please enter a valid 8-character booking code.", false);
  }

  if (!confirm("Release this room now?")) return;

  releaseBtn.disabled = true;
  show("Releasing booking...");

  try {
    const data = await apiPost(`/room/${roomId}/release`, { bookingCode });

    // Clear stored code
    localStorage.removeItem(`bookingCode:${roomId}`);

    show(data.message || "Room released successfully.", true);
  } catch (e) {
    show(e.message || "Could not release room.", false);
  } finally {
    releaseBtn.disabled = false;
  }
}

// Wire up events
extendBtn.addEventListener("click", extendBooking);
releaseBtn.addEventListener("click", releaseBooking);

// Prefill fields on load
prefillFromURL();

// Debug tip (optional): uncomment to verify where requests go
// console.log("API base:", API);