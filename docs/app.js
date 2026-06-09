const DEFAULT_API_URL = "";
const API_STORAGE_KEY = "stock_web_api_url";

const setupPanel = document.querySelector("#setupPanel");
const apiForm = document.querySelector("#apiForm");
const apiUrlInput = document.querySelector("#apiUrl");
const refreshButton = document.querySelector("#refreshButton");
const morningMeta = document.querySelector("#morningMeta");
const candidateList = document.querySelector("#candidateList");
const morningReport = document.querySelector("#morningReport");
const stockForm = document.querySelector("#stockForm");
const stockCodeInput = document.querySelector("#stockCode");
const stockPasswordInput = document.querySelector("#stockPassword");
const stockStatus = document.querySelector("#stockStatus");
const stockReport = document.querySelector("#stockReport");

let morningPayload = null;
let morningSections = [];
let selectedCandidateIndex = 0;

function getApiUrl() {
  const fromQuery = new URLSearchParams(location.search).get("api");
  const stored = localStorage.getItem(API_STORAGE_KEY);
  return (fromQuery || stored || DEFAULT_API_URL).trim();
}

function setApiUrl(url) {
  localStorage.setItem(API_STORAGE_KEY, url.trim());
}

function buildApiUrl(action, params = {}) {
  const apiUrl = getApiUrl();

  if (!apiUrl) {
    throw new Error("尚未設定 Apps Script Web App URL");
  }

  const url = new URL(apiUrl);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  return url;
}

function requestJsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `stockWebCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const url = buildApiUrl(action, params);
    const script = document.createElement("script");
    let settled = false;

    url.searchParams.set("callback", callbackName);

    const cleanup = () => {
      settled = true;
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("無法連線到 Apps Script API"));
    };

    script.src = url.toString();
    document.body.appendChild(script);

    setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(new Error("Apps Script API 回應逾時"));
      }
    }, 45000);
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false
  }).format(date);
}

function splitReport(text) {
  return String(text || "")
    .split(/\n\s*[━=\-]{6,}\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function renderReport(target, text, emptyText) {
  const parts = splitReport(text);

  if (parts.length === 0) {
    target.textContent = emptyText;
    return;
  }

  target.replaceChildren(
    ...parts.map((part, index) => {
      const block = document.createElement("pre");
      block.className = "report-block";
      block.textContent = parts.length > 1 ? `區塊 ${index + 1}\n\n${part}` : part;
      return block;
    })
  );
}

function buildMorningSections(message, candidates) {
  const parts = splitReport(message);

  if (parts.length === 0) {
    return [];
  }

  const intro = parts[0] || "";
  const stockParts = parts.slice(1);

  return (candidates || []).map((candidate, index) => {
    const detail = stockParts[index] || "";
    const title = `${candidate.name || "-"} ${candidate.code || ""}`;
    return [intro, title, detail].filter(Boolean).join("\n\n");
  });
}

function showCandidateDetail(index) {
  selectedCandidateIndex = index;

  [...candidateList.querySelectorAll(".candidate-row")].forEach((row, rowIndex) => {
    row.classList.toggle("is-active", rowIndex === selectedCandidateIndex);
  });

  const fallback = morningPayload?.message || "";
  const text = morningSections[selectedCandidateIndex] || fallback;
  renderReport(morningReport, text, "尚未產生盤前候選報告。");
}

function renderCandidates(metadata, message) {
  const candidates = metadata?.candidates || [];
  candidateList.replaceChildren();
  morningSections = buildMorningSections(message, candidates);
  selectedCandidateIndex = 0;

  if (candidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "尚無候選摘要";
    candidateList.appendChild(empty);
    return;
  }

  candidates.forEach((item, index) => {
    const row = document.createElement("button");
    row.className = "candidate-row";
    row.type = "button";
    row.addEventListener("mouseenter", () => showCandidateDetail(index));
    row.addEventListener("focus", () => showCandidateDetail(index));
    row.addEventListener("click", () => showCandidateDetail(index));

    row.innerHTML = `
      <span class="rank">${index + 1}</span>
      <span class="candidate-main">
        <strong>${escapeHtml(item.name || "-")} ${escapeHtml(item.code || "")}</strong>
        <small>${escapeHtml(item.strategy || "未標示策略")}</small>
      </span>
      <span class="score">Score ${escapeHtml(item.score ?? "-")}</span>
    `;

    candidateList.appendChild(row);
  });

  showCandidateDetail(0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadMorningReport() {
  if (!getApiUrl()) {
    setupPanel.hidden = false;
    morningMeta.textContent = "等待 API 設定";
    morningReport.textContent = "請先貼上 Apps Script Web App URL。";
    morningPayload = null;
    renderCandidates({ candidates: [] }, "");
    return;
  }

  setupPanel.hidden = true;
  morningMeta.textContent = "載入中...";
  morningReport.textContent = "正在讀取最新盤前報告...";

  try {
    const payload = await requestJsonp("morning");

    if (!payload.ok) {
      throw new Error(payload.error || "讀取失敗");
    }

    morningPayload = payload;
    const count = payload.metadata?.count ?? payload.metadata?.candidates?.length ?? 0;
    morningMeta.textContent = `${payload.date || "-"} / ${count} 檔 / 更新 ${formatDateTime(payload.updatedAt)}`;
    renderCandidates(payload.metadata, payload.message);
  } catch (error) {
    morningPayload = null;
    morningMeta.textContent = "讀取失敗";
    morningReport.textContent = error.message;
    renderCandidates({ candidates: [] }, "");
  }
}

async function queryStock(code, password) {
  stockStatus.textContent = `${code} 查詢中...`;
  stockReport.textContent = "正在產生個股報告，第一次查詢可能需要較久。";

  try {
    const payload = await requestJsonp("stock", { code, password });

    if (!payload.ok) {
      throw new Error(payload.error || "查詢失敗");
    }

    stockStatus.textContent = `${payload.code} / 更新 ${formatDateTime(payload.updatedAt)}${payload.cached ? " / 快取" : ""}`;
    renderReport(stockReport, payload.report, "沒有查詢結果。");
  } catch (error) {
    stockStatus.textContent = "查詢失敗";
    stockReport.textContent = error.message;
  }
}

apiForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = apiUrlInput.value.trim();

  if (!url) return;

  setApiUrl(url);
  loadMorningReport();
});

refreshButton.addEventListener("click", () => {
  loadMorningReport();
});

stockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = stockCodeInput.value.trim();
  const password = stockPasswordInput.value.trim();

  if (!/^\d{4,6}$/.test(code)) {
    stockStatus.textContent = "格式錯誤";
    stockReport.textContent = "請輸入 4 到 6 位數的股票代號，例如 2330。";
    return;
  }

  if (!password) {
    stockStatus.textContent = "需要密碼";
    stockReport.textContent = "請輸入查詢密碼後再查詢。";
    stockPasswordInput.focus();
    return;
  }

  queryStock(code, password);
});

apiUrlInput.value = getApiUrl();
loadMorningReport();
