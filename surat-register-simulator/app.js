// Simulasi Register Surat Desa (offline, localStorage)
// Fokus: nomor urut per klasifikasi per tahun, tidak saling campur.

const STORAGE_KEY = "sr_sim_v1";

const CLASS_LABEL = {
  OUTGOING: "Surat Keluar",
  CERTIFICATE: "Surat Keterangan",
};

const CLASS_PREFIX = {
  OUTGOING: "OUT",
  CERTIFICATE: "KET",
};

function pad(n, width = 4) {
  const s = String(n);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function ymdToYear(ymd) {
  if (!ymd) return new Date().getFullYear();
  return Number(String(ymd).slice(0, 4));
}

function nowISO() {
  const d = new Date();
  return d.toISOString();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { counters: {}, letters: [] };
    const parsed = JSON.parse(raw);
    if (!parsed.counters) parsed.counters = {};
    if (!parsed.letters) parsed.letters = [];
    return parsed;
  } catch {
    return { counters: {}, letters: [] };
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function counterKey(classification, year) {
  return `${classification}:${year}`;
}

function formatRegisterNo(classification, year, regNo) {
  return `${CLASS_PREFIX[classification]}/${year}/${pad(regNo)}`;
}

// Atomic-ish generator (single-tab safe). For multi-user server, this must be transactional DB.
function generateNextNumber(state, classification, year) {
  const key = counterKey(classification, year);
  const last = state.counters[key] ?? 0;
  const next = last + 1;
  state.counters[key] = next;
  return next;
}

function addLetter({ classification, letterDate, subject, party }) {
  const state = loadState();
  const year = ymdToYear(letterDate);
  const register_no = generateNextNumber(state, classification, year);

  const letter = {
    id: crypto.randomUUID(),
    classification,
    letter_date: letterDate,
    year,
    register_no,
    register_display: formatRegisterNo(classification, year, register_no),
    subject: subject.trim(),
    party: (party || "").trim(),
    status: "AKTIF", // AKTIF | BATAL
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  state.letters.unshift(letter); // newest first
  saveState(state);
  return letter;
}

function cancelLetter(id) {
  const state = loadState();
  const idx = state.letters.findIndex(x => x.id === id);
  if (idx === -1) return false;
  state.letters[idx].status = "BATAL";
  state.letters[idx].updated_at = nowISO();
  saveState(state);
  return true;
}

function hardDeleteLetter(id) {
  const state = loadState();
  state.letters = state.letters.filter(x => x.id !== id);
  saveState(state);
}

function exportJSON() {
  const state = loadState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `surat-register-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (!parsed || typeof parsed !== "object") throw new Error("Format tidak valid");
        if (!parsed.counters || !parsed.letters) throw new Error("JSON tidak berisi counters/letters");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        resolve(true);
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsText(file);
  });
}

// UI
const $ = (q) => document.querySelector(q);
const tbody = $("#tbody");
const counterGrid = $("#counterGrid");
const stats = $("#stats");

const form = $("#letterForm");
const classificationEl = $("#classification");
const dateEl = $("#letterDate");
const subjectEl = $("#subject");
const partyEl = $("#party");
const previewEl = $("#previewNo");

const filterClass = $("#filterClass");
const filterYear = $("#filterYear");
const searchEl = $("#search");

const btnExport = $("#btnExport");
const btnReset = $("#btnReset");
const fileImport = $("#fileImport");

// Dialog helpers
const dlg = $("#dlg");
const dlgTitle = $("#dlgTitle");
const dlgBody = $("#dlgBody");
const dlgFoot = $("#dlgFoot");
$("#dlgClose").addEventListener("click", () => dlg.close());

function showDialog({ title, bodyHTML, buttons }) {
  dlgTitle.textContent = title || "Konfirmasi";
  dlgBody.innerHTML = bodyHTML || "";
  dlgFoot.innerHTML = "";
  (buttons || []).forEach(b => {
    const btn = document.createElement("button");
    btn.className = `btn ${b.variant || "secondary"}`;
    btn.textContent = b.text;
    btn.addEventListener("click", () => {
      if (b.onClick) b.onClick();
      if (!b.keepOpen) dlg.close();
    });
    dlgFoot.appendChild(btn);
  });
  dlg.showModal();
}

function updatePreview() {
  const cls = classificationEl.value;
  const year = ymdToYear(dateEl.value || new Date().toISOString().slice(0,10));
  const state = loadState();
  const key = counterKey(cls, year);
  const next = (state.counters[key] ?? 0) + 1;
  previewEl.textContent = formatRegisterNo(cls, year, next);
}

function matchFilters(letter) {
  const cls = filterClass.value;
  const yr = filterYear.value ? Number(filterYear.value) : null;
  const q = (searchEl.value || "").trim().toLowerCase();

  if (cls !== "ALL" && letter.classification !== cls) return false;
  if (yr && letter.year !== yr) return false;

  if (q) {
    const hay = [
      letter.register_display,
      CLASS_LABEL[letter.classification],
      letter.subject,
      letter.party || "",
      letter.letter_date,
      letter.status,
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function render() {
  const state = loadState();
  const list = state.letters.filter(matchFilters);

  tbody.innerHTML = "";
  for (const letter of list) {
    const tr = document.createElement("tr");

    const statusBadge = letter.status === "AKTIF"
      ? `<span class="badge ok">● Aktif</span>`
      : `<span class="badge danger">● Batal</span>`;

    tr.innerHTML = `
      <td class="mono"><b>${letter.register_display}</b><div class="small">${letter.year} • #${letter.register_no}</div></td>
      <td>${letter.letter_date || "-"}</td>
      <td>${CLASS_LABEL[letter.classification]}</td>
      <td>${escapeHtml(letter.subject)}</td>
      <td>${escapeHtml(letter.party || "-")}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn secondary" data-act="copy" data-id="${letter.id}">Copy</button>
        ${letter.status === "AKTIF" ? `<button class="btn danger" data-act="cancel" data-id="${letter.id}">Batalkan</button>` : ""}
        <button class="btn secondary" data-act="delete" data-id="${letter.id}">Hapus</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  const total = state.letters.length;
  const aktif = state.letters.filter(x => x.status === "AKTIF").length;
  const batal = total - aktif;
  stats.textContent = `Total: ${total} • Aktif: ${aktif} • Batal: ${batal} • Ditampilkan: ${list.length}`;

  renderCounters(state);
  updatePreview();
}

function renderCounters(state) {
  const keys = Object.keys(state.counters).sort((a,b) => a.localeCompare(b));
  if (!keys.length) {
    counterGrid.innerHTML = `<div class="muted">Belum ada data. Counter akan muncul setelah kamu menyimpan surat.</div>`;
    return;
  }
  // Group by year
  const grouped = {};
  for (const k of keys) {
    const [cls, year] = k.split(":");
    if (!grouped[year]) grouped[year] = {};
    grouped[year][cls] = state.counters[k];
  }
  const years = Object.keys(grouped).sort((a,b) => Number(b) - Number(a));

  counterGrid.innerHTML = "";
  for (const year of years) {
    for (const cls of ["OUTGOING", "CERTIFICATE"]) {
      const last = grouped[year][cls] ?? 0;
      const div = document.createElement("div");
      div.className = "counterCard";
      div.innerHTML = `
        <div class="k">${CLASS_LABEL[cls]}</div>
        <div class="v mono">${CLASS_PREFIX[cls]}/${year}/${pad(last)}</div>
        <div class="s">Nomor terakhir: <b>#${last}</b></div>
      `;
      counterGrid.appendChild(div);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// Events
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const cls = classificationEl.value;
  const dt = dateEl.value;
  const subject = subjectEl.value;
  const party = partyEl.value;

  if (!dt) return alert("Tanggal surat wajib diisi.");
  if (!subject.trim()) return alert("Perihal wajib diisi.");

  const letter = addLetter({ classification: cls, letterDate: dt, subject, party });

  subjectEl.value = "";
  partyEl.value = "";

  showDialog({
    title: "Berhasil",
    bodyHTML: `
      <div>Nomor register dibuat:</div>
      <div style="margin-top:10px" class="previewValue mono"><b>${letter.register_display}</b></div>
      <div class="small" style="margin-top:10px">Catatan: Pembatalan tidak mengubah urutan. Nomor tetap tercatat untuk histori.</div>
    `,
    buttons: [
      { text: "Copy Nomor", variant: "secondary", onClick: async () => {
          await navigator.clipboard.writeText(letter.register_display);
        }, keepOpen: true
      },
      { text: "Tutup", variant: "primary" }
    ]
  });

  render();
});

[classificationEl, dateEl].forEach(el => el.addEventListener("change", updatePreview));
[filterClass, filterYear, searchEl].forEach(el => el.addEventListener("input", render));

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const state = loadState();
  const letter = state.letters.find(x => x.id === id);
  if (!letter) return;

  if (act === "copy") {
    await navigator.clipboard.writeText(letter.register_display);
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 800);
    return;
  }

  if (act === "cancel") {
    showDialog({
      title: "Batalkan surat?",
      bodyHTML: `
        <div>Ini akan mengubah status menjadi <b>BATAL</b> tanpa mengubah urutan nomor.</div>
        <div style="margin-top:10px" class="small">Target: <span class="mono"><b>${letter.register_display}</b></span></div>
      `,
      buttons: [
        { text: "Batal", variant: "secondary" },
        { text: "Ya, Batalkan", variant: "danger", onClick: () => { cancelLetter(id); render(); } }
      ]
    });
    return;
  }

  if (act === "delete") {
    showDialog({
      title: "Hapus data?",
      bodyHTML: `
        <div><b>Warning:</b> Ini menghapus data dari perangkat ini. Untuk simulasi boleh, tapi di sistem nyata biasanya pakai audit + status.</div>
        <div style="margin-top:10px" class="small">Target: <span class="mono"><b>${letter.register_display}</b></span></div>
      `,
      buttons: [
        { text: "Batal", variant: "secondary" },
        { text: "Ya, Hapus", variant: "danger", onClick: () => { hardDeleteLetter(id); render(); } }
      ]
    });
    return;
  }
});

btnExport.addEventListener("click", exportJSON);

fileImport.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    await importJSON(f);
    showDialog({
      title: "Import berhasil",
      bodyHTML: `<div>Data berhasil diimpor ke penyimpanan lokal.</div>`,
      buttons: [{ text: "OK", variant: "primary", onClick: () => render() }]
    });
  } catch (err) {
    showDialog({
      title: "Import gagal",
      bodyHTML: `<div class="small">Pesan: ${escapeHtml(err.message || String(err))}</div>`,
      buttons: [{ text: "OK", variant: "primary" }]
    });
  } finally {
    e.target.value = "";
  }
});

btnReset.addEventListener("click", () => {
  showDialog({
    title: "Reset semua data?",
    bodyHTML: `<div>Ini menghapus semua counters dan data surat dari perangkat ini.</div>`,
    buttons: [
      { text: "Batal", variant: "secondary" },
      { text: "Ya, Reset", variant: "danger", onClick: () => { localStorage.removeItem(STORAGE_KEY); render(); } }
    ]
  });
});

// Init defaults
(function init(){
  const today = new Date().toISOString().slice(0,10);
  dateEl.value = today;
  updatePreview();
  render();
})();
