// frontend/script.js

const API = (location.port === "5000") ? "/api" : "http://localhost:5000/api";

const countdowns = new Map();

function escapeHTML(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Refresh room cards (used on index.html)
async function refreshRooms() {
  const container = document.getElementById("rooms");
  if (!container) return; // Not on index page

  // Clear existing timers before re-render
  for (const [id, handle] of countdowns) {
    clearInterval(handle);
    countdowns.delete(id);
  }

  try {
    const res = await fetch(`${API}/rooms`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load rooms (${res.status})`);
    const rooms = await res.json();

    container.innerHTML = rooms
      .map((r) => {
        const statusClass = (r.status || "").toLowerCase();
        const timerHtml =
          r.status === "Occupied" && r.endTime
            ? `<p>⏱ Time left: <span id="timer-${r.id}"></span></p>`
            : "";

        // Use absolute links so they work from anywhere
        const manageLink = `<a href="/frontend/manage.html?roomId=${encodeURIComponent(
          r.id
        )}">Manage Booking</a>`;

        return `
          <div class="room ${statusClass}">
            <h3>${escapeHTML(r.name)}</h3>
            <img src="${r.qr}" width="100" loading="lazy"
                 alt="QR for ${escapeHTML(r.name)}"
                 title="Scan to view this room" />
            <p>Status: <b>${escapeHTML(r.status)}</b></p>
            ${
              r.status === "Occupied"
                ? `
              <p>Booked by: ${escapeHTML(r.bookedBy || "")}</p>
              <p>Purpose: ${escapeHTML(r.purpose || "")}</p>
              ${timerHtml}
              ${manageLink}
            `
                : `
              <a href="/frontend/book.html?roomId=${encodeURIComponent(r.id)}">Book Now</a>
            `
            }
          </div>
        `;
      })
      .join("");

    // Start countdowns
    rooms.forEach((r) => {
      if (r.status === "Occupied" && r.endTime) {
        const endMs =
          typeof r.endTime === "string" ? Date.parse(r.endTime) : Number(r.endTime);
        if (!Number.isNaN(endMs)) startCountdown(r.id, endMs);
      }
    });
  } catch (e) {
    container.innerHTML = `<p style="color:#ffb4b4">Could not load rooms. ${escapeHTML(
      e.message
    )}</p>`;
  }
}

function startCountdown(id, endTimeMs) {
  const update = () => {
    const el = document.getElementById(`timer-${id}`);
    if (!el) return; // DOM may have been re-rendered

    const diff = endTimeMs - Date.now();
    if (diff <= 0) {
      el.textContent = "Available";
      const handle = countdowns.get(id);
      if (handle) {
        clearInterval(handle);
        countdowns.delete(id);
      }
      // Refresh to update status
      refreshRooms();
      return;
    }

    const totalSec = Math.floor(diff / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    el.textContent =
      hrs > 0
        ? `${hrs}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`
        : `${mins}m ${String(secs).padStart(2, "0")}s`;
  };

  update();
  const handle = setInterval(update, 1000);
  countdowns.set(id, handle);
}

// Booking form handler (used on book.html)
const form = document.getElementById("bookingForm");
if (form) {
  // Prefill roomId from ?roomId= or ?id=
  const params = new URLSearchParams(location.search);
  const prefillId = params.get("roomId") || params.get("id");
  if (prefillId) {
    const roomInput = document.getElementById("roomId");
    if (roomInput) roomInput.value = prefillId;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;

    const studentName = document.getElementById("studentName").value.trim();
    const purpose = document.getElementById("purpose").value.trim();
    const duration = parseInt(document.getElementById("duration").value, 10);
    const roomId = parseInt(document.getElementById("roomId").value, 10);
    const resultEl = document.getElementById("result");

    try {
      const res = await fetch(`${API}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, studentName, purpose, duration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || `Booking failed (${res.status})`);

      // Expect bookingCode in the response (from updated server.js)
      
      const bookingCode = data.bookingCode || data.room?.bookingCode;
      if (bookingCode) {
        // Save for auto-prefill on Manage page (same browser)
        try { localStorage.setItem(`bookingCode:${roomId}`, bookingCode); } catch (_) {}
      }

      // Show blocking alert with the code so it doesn't disappear
      alert(
        `✅ Booking successful!\n\n` +
        `Room ID: ${roomId}\n` +
        (bookingCode ? `Booking Code: ${bookingCode}\n` : ``) +
        `\nSave this code to extend or release your booking from the Manage page.`
      );

      // Keep a visible message on the page too
      resultEl.innerHTML = `
        ✅ ${escapeHTML(data.message || "Booked!") }<br/>
        ${
          bookingCode
            ? `<b>Booking code:</b> <code>${escapeHTML(bookingCode)}</code><br/>`
            : `<i>(No booking code received)</i><br/>`
        }
        <a href="/frontend/manage.html?roomId=${encodeURIComponent(roomId)}">Manage this booking</a>
      `;
      resultEl.style.color = "#006400";

      // Reset fields but keep roomId visible
      form.reset();
      document.getElementById("roomId").value = String(roomId);
    } catch (err) {
      resultEl.textContent = err.message || "Something went wrong.";
      resultEl.style.color = "#dc3545";
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// Initial load (safe no-op on pages without #rooms)
refreshRooms();
// Ensure the Refresh button (onclick="refreshRooms()") works
window.refreshRooms = refreshRooms;