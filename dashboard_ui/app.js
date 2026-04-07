const state = {
  dashboard: null,
  selectedRun: null,
  selectedRunId: null,
  selectedBaseline: null,
  baselineCache: new Map(),
  activeActionTab: "action-create",
  activeView: "view-results",
  lightboxOpen: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPill(value, extra = "") {
  const normalized = (value || "pending").toLowerCase();
  return `<span class="pill ${normalized} ${extra}">${escapeHtml(normalized)}</span>`;
}

function infoPill(value, extra = "") {
  return `<span class="pill neutral ${extra}">${escapeHtml(value || "n/a")}</span>`;
}

function metricCard(label, value, helper) {
  return `
    <article class="metric-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
      <div class="helper">${escapeHtml(helper || "")}</div>
    </article>
  `;
}

function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (["fail", "rejected", "high"].includes(normalized)) {
    return "fail";
  }
  if (["approved", "pass", "auto-pass", "low"].includes(normalized)) {
    return "pass";
  }
  return "pending";
}

function summaryCard(label, value, helper, tone = "neutral") {
  return `
    <article class="summary-tile ${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(helper || "")}</small>
    </article>
  `;
}

function openImageLightbox(src, alt = "", caption = "") {
  const lightbox = document.getElementById("image-lightbox");
  const image = document.getElementById("lightbox-image");
  const captionRoot = document.getElementById("lightbox-caption");
  if (!lightbox || !image || !captionRoot || !src) {
    return;
  }
  image.src = src;
  image.alt = alt || "Expanded preview";
  captionRoot.textContent = caption || alt || "";
  lightbox.classList.remove("hidden");
  document.body.classList.add("lightbox-open");
  state.lightboxOpen = true;
}

function closeImageLightbox() {
  const lightbox = document.getElementById("image-lightbox");
  const image = document.getElementById("lightbox-image");
  const captionRoot = document.getElementById("lightbox-caption");
  if (!lightbox || !image || !captionRoot) {
    return;
  }
  lightbox.classList.add("hidden");
  image.src = "";
  captionRoot.textContent = "";
  document.body.classList.remove("lightbox-open");
  state.lightboxOpen = false;
}

function bindPreviewImages(scope = document) {
  scope.querySelectorAll("[data-preview-src]").forEach((node) => {
    if (node.dataset.previewBound === "true") {
      return;
    }
    node.dataset.previewBound = "true";
    node.addEventListener("click", () => {
      openImageLightbox(
        node.getAttribute("data-preview-src"),
        node.getAttribute("data-preview-alt") || node.getAttribute("alt") || "",
        node.getAttribute("data-preview-caption") || "",
      );
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = rawText;
  }
  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && (payload.error || payload.stderr || payload.stdout)) ||
      rawText ||
      `Request failed: ${response.status}`;
    const error = new Error(String(message));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function postJson(url, payload) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function parseMaybeNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isNaN(num) ? value : num;
}

function formToPayload(form) {
  const payload = {};
  const formData = new FormData(form);
  for (const [key, rawValue] of formData.entries()) {
    const sameNamedInputs = Array.from(form.querySelectorAll(`[name="${CSS.escape(key)}"]`));
    const checkboxGroup = sameNamedInputs.filter((element) => element instanceof HTMLInputElement && element.type === "checkbox");
    if (checkboxGroup.length > 1) {
      if (!Array.isArray(payload[key])) {
        payload[key] = [];
      }
      payload[key].push(String(rawValue).trim());
      continue;
    }
    const element = form.elements[key];
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      payload[key] = element.checked;
      continue;
    }
    const value = String(rawValue).trim();
    if (!value) {
      continue;
    }
    if (["threshold_pct", "pixel_threshold", "min_region_area", "wait_ms", "timeout_ms"].includes(key)) {
      payload[key] = parseMaybeNumber(value);
    } else {
      payload[key] = value;
    }
  }

  Array.from(form.querySelectorAll('input[type="checkbox"]')).forEach((checkbox) => {
    const sameNamed = Array.from(form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(checkbox.name)}"]`));
    if (sameNamed.length > 1) {
      return;
    }
    payload[checkbox.name] = checkbox.checked;
  });

  return payload;
}

function actionProgressLabel(action, phase) {
  const labels = {
    "create-baseline": {
      start: "Preparing baseline capture...",
      progress: "Creating baseline...",
      success: "Baseline created.",
      error: "Baseline creation failed.",
    },
    "update-baseline": {
      start: "Preparing baseline update...",
      progress: "Updating baseline...",
      success: "Baseline updated.",
      error: "Baseline update failed.",
    },
    compare: {
      start: "Preparing compare...",
      progress: "Comparing page against baseline...",
      success: "Compare completed.",
      error: "Compare failed.",
    },
    "run-suite": {
      start: "Preparing suite run...",
      progress: "Running suite...",
      success: "Suite completed.",
      error: "Suite run failed.",
    },
    "create-multiple-baselines": {
      start: "Preparing site crawl...",
      progress: "Discovering pages and creating baselines...",
      success: "Multiple baselines created.",
      error: "Multiple baseline creation failed.",
    },
  };
  return labels[action]?.[phase] || "";
}

function setActionFormState(form, running, statusText = "", statusKind = "") {
  form.classList.toggle("is-running", running);
  form.querySelectorAll("input, select, textarea, button").forEach((element) => {
    if (!(element instanceof HTMLButtonElement) || element.type === "submit") {
      element.disabled = running;
    }
  });

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) {
    if (!submitButton.dataset.defaultLabel) {
      submitButton.dataset.defaultLabel = submitButton.textContent || "Submit";
    }
    submitButton.textContent = running ? "Running..." : submitButton.dataset.defaultLabel;
  }

  const feedback = form.querySelector(".action-feedback");
  if (feedback) {
    feedback.className = `action-feedback${statusKind ? ` ${statusKind}` : ""}`;
    feedback.textContent = statusText;
  }
}

function uniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))].sort();
}

function summarizeAttentionBadge(runs) {
  const attentionCount = new Set(
    runs
      .filter((item) => item.status === "FAIL" || (item.decision_status || "pending") === "pending" || item.severity?.label === "high")
      .map((item) => item.run),
  ).size;
  if (!attentionCount) {
    return "All clear right now";
  }
  if (attentionCount === 1) {
    return "1 run needs attention";
  }
  return `${attentionCount} runs need attention`;
}

function writeConsole(message, mode = "info") {
  const target = document.getElementById("console-output");
  if (!target) {
    return;
  }
  const stamp = new Date().toLocaleTimeString();
  const next = `[${stamp}] ${message}`;
  target.textContent = mode === "replace" ? next : `${next}\n\n${target.textContent}`.trim();
}

function setActiveTab(group, targetId) {
  document.querySelectorAll(`[data-tab-group="${group}"]`).forEach((button) => {
    const isActive = button.getAttribute("data-tab-target") === targetId;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    if (!panel.id) {
      return;
    }
    const isSameGroup =
      (group === "actions" && panel.id.startsWith("action-")) ||
      (group === "library" && panel.id.startsWith("library-"));
    if (!isSameGroup) {
      return;
    }
    panel.classList.toggle("active", panel.id === targetId);
  });

  if (group === "actions") {
    state.activeActionTab = targetId;
  }
}

function setActiveView(targetId) {
  state.activeView = targetId;
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    const isActive = button.getAttribute("data-view-target") === targetId;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.getAttribute("data-view-panel") === targetId);
  });
}

function renderMetrics(dashboard) {
  const root = document.getElementById("metrics-grid");
  const metrics = dashboard.metrics;
  const runs = dashboard.runs || [];
  const highSeverity = runs.filter((item) => item.severity?.label === "high").length;
  const needsAttention = new Set(
    runs
      .filter((item) => item.status === "FAIL" || (item.decision_status || "pending") === "pending" || item.severity?.label === "high")
      .map((item) => item.run),
  ).size;

  root.innerHTML = [
    metricCard("Baselines", metrics.baseline_count, "Standards currently available"),
    metricCard("Runs", metrics.run_count, "Stored compare and suite executions"),
    metricCard("Needs Attention", needsAttention, highSeverity ? `${highSeverity} high-severity runs should be checked first` : "Failures and undecided diffs are grouped here"),
    metricCard("Coverage", `${metrics.browser_coverage || 0} / ${metrics.device_coverage || 0} / ${metrics.locale_coverage || 0}`, "Browsers / devices / locales represented"),
  ].join("");
}

function renderResultsStrip(runs, latestSuite) {
  const root = document.getElementById("results-strip");
  if (!root) {
    return;
  }
  const latestRun = runs[0];
  const latestStatus = latestRun?.status || "No runs yet";
  const latestMismatch = latestRun?.mismatch_pct != null ? `${latestRun.mismatch_pct}% mismatch` : "No mismatch recorded";
  const suiteLine = latestSuite
    ? `${latestSuite.passed || 0} passed / ${latestSuite.failed || 0} failed / ${latestSuite.errors || 0} errors`
    : "Run a suite to populate batch status";

  root.innerHTML = [
    summaryCard("Latest Run", latestStatus, latestRun?.case_name || latestMismatch, statusTone(latestRun?.status)),
    summaryCard("Latest Suite", latestSuite ? String(latestSuite.executed || 0) : "0", suiteLine, latestSuite && ((latestSuite.failed || 0) || (latestSuite.errors || 0)) ? "fail" : "neutral"),
  ].join("");
}

function renderFilterOptions(runs) {
  const statusFilter = document.getElementById("status-filter");
  const decisionFilter = document.getElementById("decision-filter");
  const browserFilter = document.getElementById("browser-filter");
  const deviceFilter = document.getElementById("device-filter");
  const localeFilter = document.getElementById("locale-filter");

  const currentStatus = statusFilter.value;
  const currentDecision = decisionFilter.value;
  const currentBrowser = browserFilter.value;
  const currentDevice = deviceFilter.value;
  const currentLocale = localeFilter.value;

  statusFilter.innerHTML = ["<option value=''>All statuses</option>", ...uniqueValues(runs, "status").map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  decisionFilter.innerHTML = ["<option value=''>All decisions</option>", ...uniqueValues(runs, "decision_status").map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  browserFilter.innerHTML = ["<option value=''>All browsers</option>", ...uniqueValues(runs, "browser").map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  deviceFilter.innerHTML = ["<option value=''>All devices</option>", ...uniqueValues(runs.map((item) => ({ ...item, device_label: item.device || "desktop" })), "device_label").map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  localeFilter.innerHTML = ["<option value=''>All locales</option>", ...uniqueValues(runs, "locale").map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");

  statusFilter.value = currentStatus;
  decisionFilter.value = currentDecision;
  browserFilter.value = currentBrowser;
  deviceFilter.value = currentDevice;
  localeFilter.value = currentLocale;
}

function filteredRuns() {
  const runs = state.dashboard?.runs || [];
  const search = document.getElementById("run-search").value.trim().toLowerCase();
  const status = document.getElementById("status-filter").value;
  const decision = document.getElementById("decision-filter").value;
  const browser = document.getElementById("browser-filter").value;
  const device = document.getElementById("device-filter").value;
  const locale = document.getElementById("locale-filter").value;

  return runs.filter((item) => {
    if (status && item.status !== status) {
      return false;
    }
    if (decision && (item.decision_status || "pending") !== decision) {
      return false;
    }
    if (browser && item.browser !== browser) {
      return false;
    }
    if (device && (item.device || "desktop") !== device) {
      return false;
    }
    if (locale && item.locale !== locale) {
      return false;
    }
    if (!search) {
      return true;
    }
    const haystack = [item.run, item.case_name, item.url, item.suite_name, item.baseline_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function filteredBaselines() {
  const baselines = state.dashboard?.baselines || [];
  const search = (document.getElementById("baseline-search")?.value || "").trim().toLowerCase();
  if (!search) {
    return baselines;
  }
  return baselines.filter((item) => {
    const haystack = [
      item.name,
      item.url,
      item.browser,
      item.device || "desktop",
      item.locale || "default",
      item.updated_at,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function renderRuns() {
  const root = document.getElementById("runs-body");
  const runs = filteredRuns();
  root.innerHTML = runs.length
    ? runs.map((item) => {
        const selectedClass = item.run === state.selectedRunId ? "selected" : "";
        return `
          <tr class="run-row ${selectedClass}" data-run="${escapeHtml(item.run)}">
            <td>
              <strong>${escapeHtml(item.case_name || item.run)}</strong>
              <div class="cell-subtle">${escapeHtml(item.run)}</div>
              <div class="cell-subtle">${escapeHtml(item.browser || "n/a")} | ${escapeHtml(item.device || "desktop")} | ${escapeHtml(item.locale || "default")}</div>
            </td>
            <td>${formatPill(item.status || "pending")}</td>
            <td>${formatPill(item.decision_status || "pending")}</td>
            <td>
              <strong>${item.mismatch_pct ?? "n/a"}</strong>
              <div class="cell-subtle">${escapeHtml(item.diff_regions ?? 0)} regions</div>
            </td>
            <td>${formatPill(item.severity?.label || "pending", "small")}</td>
            <td>
              <strong>${escapeHtml(item.ai_label || "n/a")}</strong>
              <div class="cell-subtle">${item.ai_score ?? "n/a"}${item.ai_explanation ? ` | ${escapeHtml(item.ai_explanation)}` : ""}</div>
            </td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="6"><div class="empty-inline">No runs match the current filters.</div></td></tr>`;

  root.querySelectorAll(".run-row").forEach((row) => {
    row.addEventListener("click", () => {
      const runId = row.getAttribute("data-run");
      if (runId && runId === state.selectedRunId) {
        clearRunSelection();
        return;
      }
      selectRun(runId);
    });
  });
}

function fillBaselineSelects(items) {
  const markup = ["<option value=''>Select baseline</option>", ...items.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`)].join("");
  document.getElementById("update-baseline-select").innerHTML = markup;
  document.getElementById("compare-baseline-select").innerHTML = markup;
}

function renderBaselineStrip(items) {
  const root = document.getElementById("baseline-strip");
  if (!root) {
    return;
  }
  const totalVersions = items.reduce((count, item) => count + Number(item.version_count || 0), 0);
  const latestUpdated = items
    .map((item) => item.updated_at)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  const deviceCount = new Set(items.map((item) => item.device || "desktop")).size;
  const localeCount = new Set(items.map((item) => item.locale || "default")).size;
  root.innerHTML = [
    summaryCard("Total Baselines", String(items.length), "Current standards in the workspace", "neutral"),
    summaryCard("Archived Versions", String(totalVersions), totalVersions ? "Older approved states kept for restore" : "No archived versions yet", totalVersions ? "pending" : "neutral"),
    summaryCard("Device Spread", String(deviceCount), "Distinct device profiles represented", "neutral"),
    summaryCard("Locale Spread", String(localeCount), "Distinct locale variants represented", "neutral"),
    summaryCard("Latest Update", latestUpdated || "n/a", "Most recent baseline refresh", latestUpdated ? "pass" : "neutral"),
  ].join("");
}

function renderBaselines(items) {
  const root = document.getElementById("baseline-list");
  fillBaselineSelects(items);
  const filtered = filteredBaselines();
  renderBaselineStrip(items);
  root.innerHTML = filtered.length
    ? filtered.map((item) => `
        <article class="baseline-item ${state.selectedBaseline?.name === item.name ? "selected" : ""}" data-baseline="${escapeHtml(item.name)}">
          <div class="baseline-thumb-wrap">
            <img class="baseline-thumb preview-image" src="${escapeHtml(item.thumbnail_href)}" alt="${escapeHtml(item.name)} baseline preview" data-preview-src="${escapeHtml(item.thumbnail_href)}" data-preview-alt="${escapeHtml(item.name)} baseline preview" data-preview-caption="${escapeHtml(item.name)}" />
          </div>
          <div class="baseline-copy">
            <div class="card-title-row">
              <strong>${escapeHtml(item.name)}</strong>
              <span class="pill neutral small">${item.version_count || 0} versions</span>
            </div>
            <div class="baseline-signal-row">
              ${infoPill(item.browser || "unknown", "small")}
              ${infoPill(item.device || "desktop", "small")}
              ${infoPill(item.locale || "default", "small")}
            </div>
            <div class="meta-list">
              <div><span>Updated</span><strong>${escapeHtml(item.updated_at || "n/a")}</strong></div>
              <div><span>URL</span><strong>${escapeHtml(item.url || "No URL captured")}</strong></div>
              <div><span>Browser</span><strong>${escapeHtml(item.browser || "n/a")}</strong></div>
              <div><span>Device</span><strong>${escapeHtml(item.device || "desktop")}</strong></div>
              <div><span>Locale</span><strong>${escapeHtml(item.locale || "default")}</strong></div>
            </div>
            <div class="button-row split-row">
              <button class="secondary-btn baseline-view-btn" type="button" data-baseline="${escapeHtml(item.name)}">Inspect</button>
              <button class="ghost-btn baseline-prefill-btn" type="button" data-baseline="${escapeHtml(item.name)}">Prefill Forms</button>
            </div>
          </div>
        </article>
      `).join("")
    : `<article class="empty-card">${items.length ? "No baselines match the current search." : "No baselines yet. Create one from Actions when you are ready."}</article>`;

  root.querySelectorAll(".baseline-view-btn, .baseline-prefill-btn, .baseline-item").forEach((node) => {
    node.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-baseline]") || node.closest("[data-baseline]") || node;
      const name = target?.getAttribute("data-baseline") || node.getAttribute("data-baseline");
      if (!name) {
        return;
      }
      const wantsPrefill = event.target.closest(".baseline-prefill-btn");
      if (!wantsPrefill && name === state.selectedBaseline?.name) {
        clearBaselineSelection();
        return;
      }
      await selectBaseline(name, { prefill: Boolean(wantsPrefill) });
    });
  });
  bindPreviewImages(root);
}

function countSelectedCompareOptions() {
  const form = document.querySelector('[data-action-form="compare"]');
  if (!form) {
    return {
      count: 0,
      selectedBrowsers: 0,
      selectedDevices: 0,
      selectedLocales: 0,
      defaultDimensions: [],
    };
  }
  const selectedBrowsers = form.querySelectorAll('input[name="browsers"]:checked').length;
  const selectedDevices = form.querySelectorAll('input[name="devices"]:checked').length;
  const selectedLocales = form.querySelectorAll('input[name="locales"]:checked').length;
  const defaultDimensions = [];
  if (!selectedBrowsers) {
    defaultDimensions.push("browser");
  }
  if (!selectedDevices) {
    defaultDimensions.push("device");
  }
  if (!selectedLocales) {
    defaultDimensions.push("locale");
  }
  const count = (selectedBrowsers || 1) * (selectedDevices || 1) * (selectedLocales || 1);
  return {
    count,
    selectedBrowsers,
    selectedDevices,
    selectedLocales,
    defaultDimensions,
  };
}

function updateCompareCount() {
  const root = document.getElementById("compare-count");
  if (!root) {
    return;
  }
  const selection = countSelectedCompareOptions();
  const count = selection.count;
  if (!count) {
    root.textContent = "Select a baseline to compare.";
    return;
  }
  if (!selection.defaultDimensions.length) {
    root.textContent = `This will run ${count} comparison${count === 1 ? "" : "s"}.`;
    return;
  }
  const dimensionText =
    selection.defaultDimensions.length === 3
      ? "the baseline defaults"
      : `the baseline default ${selection.defaultDimensions.join(" and ")}`;
  root.textContent = `This will run ${count} comparison${count === 1 ? "" : "s"} using ${dimensionText}.`;
}

function renderModels(items) {
  const root = document.getElementById("model-list");
  root.innerHTML = items.length
    ? items.map((item) => `
        <article class="model-item">
          <strong>${escapeHtml(item.name)}</strong>
          <div class="meta-list compact-grid">
            <div><span>Architecture</span><strong>${escapeHtml(item.architecture ?? item.model_type ?? "n/a")}</strong></div>
            <div><span>Backbone</span><strong>${escapeHtml(item.backbone ?? "n/a")}</strong></div>
            <div><span>Samples</span><strong>${escapeHtml(item.samples ?? "n/a")}</strong></div>
            <div><span>Accuracy</span><strong>${escapeHtml(item.accuracy ?? "n/a")}</strong></div>
            <div><span>Epochs</span><strong>${escapeHtml(item.epochs ?? "n/a")}</strong></div>
            <div><span>Updated</span><strong>${escapeHtml(item.updated_at ?? item.trained_at ?? "n/a")}</strong></div>
          </div>
        </article>
      `).join("")
    : `<article class="empty-card">No trained model metadata found.</article>`;
}

function renderSummaries(items) {
  const root = document.getElementById("summary-grid");
  root.innerHTML = items.length
    ? items.map((item) => `
        <article class="summary-card">
          <div class="card-title-row">
            <strong>${escapeHtml(item.file || "suite-summary")}</strong>
            ${formatPill((item.failed || item.errors) ? "fail" : "pass", "small")}
          </div>
          <div class="meta-list compact-grid">
            <div><span>Passed</span><strong>${escapeHtml(item.passed ?? 0)}</strong></div>
            <div><span>Failed</span><strong>${escapeHtml(item.failed ?? 0)}</strong></div>
            <div><span>Errors</span><strong>${escapeHtml(item.errors ?? 0)}</strong></div>
            <div><span>Executed</span><strong>${escapeHtml(item.executed ?? 0)}</strong></div>
          </div>
        </article>
      `).join("")
    : `<article class="empty-card">No suite summary found yet.</article>`;
}

function statCard(label, value, helper = "") {
  return `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? "n/a")}</strong>
      <small>${escapeHtml(helper)}</small>
    </article>
  `;
}

function renderDecisionHistory(decision, history = []) {
  const root = document.getElementById("decision-history");
  const entries = history.length ? history : (decision?.status ? [decision] : []);
  if (!entries.length) {
    root.innerHTML = `<div class="empty-card tight">No decision recorded yet.</div>`;
    return;
  }
  root.innerHTML = `
    <table class="mini-table">
      <thead>
        <tr><th>Status</th><th>Decider</th><th>Timestamp</th><th>Comment</th></tr>
      </thead>
      <tbody>
        ${entries.slice().reverse().map((item) => `
          <tr>
            <td>${formatPill(item.status || "pending", "small")}</td>
            <td>${escapeHtml(item.decider || item.reviewer || "n/a")}</td>
            <td>${escapeHtml(item.timestamp || "n/a")}</td>
            <td>${escapeHtml(item.comment || "-")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderBaselineContext(payload, baselineDetails) {
  const root = document.getElementById("run-baseline-context");
  if (!payload) {
    root.innerHTML = `<div class="empty-card tight">No baseline context available.</div>`;
    return;
  }
  root.innerHTML = `
    <div class="meta-list">
      <div><span>Baseline</span><strong>${escapeHtml(payload.baseline_name || "n/a")}</strong></div>
      <div><span>Suite</span><strong>${escapeHtml(payload.suite_name || "ad-hoc")}</strong></div>
      <div><span>Severity</span><strong>${escapeHtml(payload.severity?.label || "n/a")} (${escapeHtml(payload.severity?.score ?? "n/a")})</strong></div>
      <div><span>AI Explanation</span><strong>${escapeHtml(payload.ai_explanation || "n/a")}</strong></div>
      <div><span>Recommended Next Step</span><strong>${escapeHtml(payload.status === "FAIL" ? "Inspect the report and record a decision." : "Run looks healthy unless a manual review is still required.")}</strong></div>
    </div>
    ${baselineDetails?.current_image_href ? `<img class="context-image preview-image" src="${escapeHtml(baselineDetails.current_image_href)}" alt="Baseline preview" data-preview-src="${escapeHtml(baselineDetails.current_image_href)}" data-preview-alt="Baseline preview" data-preview-caption="${escapeHtml(payload.baseline_name || "Baseline")}" />` : ""}
  `;
  bindPreviewImages(root);
}

function renderRunMeta(payload) {
  const root = document.getElementById("run-meta-card");
  if (!payload) {
    root.innerHTML = "";
    return;
  }
  const capture = payload.capture || {};
  const result = payload.result || {};
  root.innerHTML = `
    <div class="mini-head"><h3>Run Context</h3></div>
    <div class="run-focus-card ${escapeHtml(statusTone(payload.status))}">
      <strong>${escapeHtml(payload.severity?.label === "high" ? "Needs attention" : payload.status === "PASS" ? "Looks stable" : "Review this change")}</strong>
      <span>${escapeHtml(payload.ai_explanation || "The run metadata is ready for inspection.")}</span>
    </div>
    <div class="meta-list two-col-list">
      <div><span>Case</span><strong>${escapeHtml(payload.case_name || payload.run || "n/a")}</strong></div>
      <div><span>Run</span><strong>${escapeHtml(payload.run || "n/a")}</strong></div>
      <div><span>URL</span><strong>${escapeHtml(capture.url || "n/a")}</strong></div>
      <div><span>Browser</span><strong>${escapeHtml(capture.browser || "n/a")}</strong></div>
      <div><span>Locale</span><strong>${escapeHtml(capture.locale || "default")}</strong></div>
      <div><span>Device</span><strong>${escapeHtml(capture.device || "desktop")}</strong></div>
      <div><span>Timezone</span><strong>${escapeHtml(capture.timezone_id || "default")}</strong></div>
      <div><span>Viewport</span><strong>${escapeHtml(capture.viewport ? `${capture.viewport[0]}x${capture.viewport[1]}` : "preset/default")}</strong></div>
      <div><span>Mismatch %</span><strong>${escapeHtml(result.mismatch_pct ?? "n/a")}</strong></div>
      <div><span>Diff Regions</span><strong>${escapeHtml((result.regions || []).length)}</strong></div>
      <div><span>AI Label</span><strong>${escapeHtml(payload.ai_assessment?.label || "n/a")}</strong></div>
      <div><span>AI Score</span><strong>${escapeHtml(payload.ai_assessment?.score ?? "n/a")}</strong></div>
      <div><span>Decision</span><strong>${escapeHtml(payload.decision?.status || payload.review?.status || "pending")}</strong></div>
      <div><span>Decider</span><strong>${escapeHtml(payload.decision?.decider || payload.decision?.reviewer || payload.review?.reviewer || "n/a")}</strong></div>
    </div>
  `;
}

function renderDetail(payload, baselineDetails = null) {
  document.getElementById("run-detail-panel").classList.remove("hidden");
  document.querySelector(".board-runs")?.classList.add("has-selection");
  state.selectedRun = payload;
  state.selectedRunId = payload.run;
  document.getElementById("detail-run-title").textContent = payload.case_name || payload.run || "Run Detail";
  document.getElementById("decision-run-id").value = payload.run || "";
  document.getElementById("open-report-link").href = payload.report_href || "#";
  document.getElementById("report-frame").src = payload.report_href || "about:blank";

  const result = payload.result || {};
  const stats = document.getElementById("run-stats-grid");
  stats.innerHTML = [
    statCard("Status", payload.status || "n/a", payload.case_name || "Selected run"),
    statCard("Decision", payload.decision?.status || payload.review?.status || "pending", payload.decision?.decider || payload.decision?.reviewer || payload.review?.reviewer || "Awaiting decision"),
    statCard("Mismatch %", result.mismatch_pct ?? "n/a", "Pixel mismatch against baseline"),
    statCard("Diff Regions", (result.regions || []).length, "Clustered changed areas"),
    statCard("Severity", payload.severity?.label || "n/a", `score ${payload.severity?.score ?? "n/a"}`),
    statCard("AI", payload.ai_assessment?.label || "n/a", `score ${payload.ai_assessment?.score ?? "n/a"}`),
  ].join("");

  renderRunMeta(payload);
  renderDecisionHistory(payload.decision || payload.review || null, payload.decision_history || payload.review_history || []);
  renderBaselineContext(payload, baselineDetails);
  renderRuns();
}

function clearRunSelection() {
  state.selectedRun = null;
  state.selectedRunId = null;
  document.getElementById("run-detail-panel")?.classList.add("hidden");
  document.querySelector(".board-runs")?.classList.remove("has-selection");
  document.getElementById("decision-run-id").value = "";
  document.getElementById("report-frame").src = "about:blank";
  document.getElementById("open-report-link").href = "#";
  renderRuns();
}

function renderBaselineDetail(detail) {
  const panel = document.getElementById("baseline-detail-panel");
  const board = document.querySelector(".board-assets");
  const root = document.getElementById("baseline-detail");
  document.getElementById("baseline-detail-title").textContent = detail?.name || "Baseline Detail";
  if (!detail) {
    panel?.classList.add("hidden");
    board?.classList.remove("has-selection");
    root.innerHTML = `<div class="empty-card">Select a baseline from the list to inspect version history and metadata.</div>`;
    return;
  }
  panel?.classList.remove("hidden");
  board?.classList.add("has-selection");

  root.innerHTML = `
    <div class="info-card tone-card">
      <img class="baseline-detail-image preview-image" src="${escapeHtml(detail.current_image_href)}" alt="${escapeHtml(detail.name)} baseline" data-preview-src="${escapeHtml(detail.current_image_href)}" data-preview-alt="${escapeHtml(detail.name)} baseline" data-preview-caption="${escapeHtml(detail.name)}" />
      <div class="baseline-signal-row detail-signals">
        ${infoPill(detail.capture?.browser || "unknown", "small")}
        ${infoPill(detail.capture?.device || "desktop", "small")}
        ${infoPill(detail.capture?.locale || "default", "small")}
        ${infoPill(`${detail.versions?.length || 0} archived`, "small")}
      </div>
      <div class="meta-list two-col-list">
        <div><span>Name</span><strong>${escapeHtml(detail.name)}</strong></div>
        <div><span>Updated</span><strong>${escapeHtml(detail.updated_at || "n/a")}</strong></div>
        <div><span>Created</span><strong>${escapeHtml(detail.created_at || "n/a")}</strong></div>
        <div><span>Capture URL</span><strong>${escapeHtml(detail.capture?.url || "n/a")}</strong></div>
        <div><span>Browser</span><strong>${escapeHtml(detail.capture?.browser || "n/a")}</strong></div>
        <div><span>Device</span><strong>${escapeHtml(detail.capture?.device || "desktop")}</strong></div>
        <div><span>Locale</span><strong>${escapeHtml(detail.capture?.locale || "default")}</strong></div>
        <div><span>Viewport</span><strong>${escapeHtml(detail.capture?.viewport ? `${detail.capture.viewport[0]}x${detail.capture.viewport[1]}` : "preset/default")}</strong></div>
      </div>
    </div>

    <div class="info-card">
      <div class="mini-head"><h3>Change Log</h3></div>
      ${detail.history?.length ? `
        <table class="mini-table">
          <thead><tr><th>Timestamp</th><th>Actor</th><th>Source</th><th>URL</th></tr></thead>
          <tbody>
            ${detail.history.slice().reverse().map((item) => `
              <tr>
                <td>${escapeHtml(item.timestamp || "n/a")}</td>
                <td>${escapeHtml(item.actor || "system")}</td>
                <td>${escapeHtml(item.source || "capture")}</td>
                <td>${escapeHtml(item.url || "-")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty-card tight">No baseline history recorded yet.</div>`}
    </div>

    <div class="info-card">
      <div class="mini-head"><h3>Archived Versions</h3></div>
      ${detail.versions?.length ? `
        <div class="version-list">
          ${detail.versions.map((version) => `
            <article class="version-item">
              <div>
                <strong>${escapeHtml(version.version || "version")}</strong>
                <div class="cell-subtle">Archived ${escapeHtml(version.archived_at || "n/a")}</div>
              </div>
              <div class="button-row version-actions">
                <button class="secondary-btn restore-version-btn" type="button" data-version="${escapeHtml(version.version || "")}">Restore</button>
                <a class="ghost-btn" href="${escapeHtml(version.image_href)}" target="_blank" rel="noreferrer">Open Image</a>
              </div>
            </article>
          `).join("")}
        </div>
      ` : `<div class="empty-card tight">No archived versions yet. The first update will start the version chain.</div>`}
    </div>
  `;

  root.querySelectorAll(".restore-version-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const version = button.getAttribute("data-version");
      restoreBaselineVersion(detail.name, version).catch((error) => writeConsole(String(error), "replace"));
    });
  });
  bindPreviewImages(root);
}

function clearBaselineSelection() {
  state.selectedBaseline = null;
  renderBaselineDetail(null);
  renderBaselines(state.dashboard?.baselines || []);
}

async function deleteRun(runId) {
  if (!runId) {
    return;
  }
  const confirmed = window.confirm(`Delete run "${runId}"? This will remove its report and artifacts.`);
  if (!confirmed) {
    return;
  }
  await postJson("/api/run/delete", { run: runId });
  writeConsole(`Deleted run ${runId}.`, "replace");
  clearRunSelection();
  await refreshDashboard();
}

async function deleteBaseline(name) {
  if (!name) {
    return;
  }
  const confirmed = window.confirm(`Delete baseline "${name}"? This will remove the baseline and all archived versions.`);
  if (!confirmed) {
    return;
  }
  await postJson("/api/baseline/delete", { name });
  writeConsole(`Deleted baseline ${name}.`, "replace");
  state.baselineCache.delete(name);
  clearBaselineSelection();
  await refreshDashboard();
}

async function restoreBaselineVersion(name, version) {
  if (!name || !version) {
    return;
  }
  const confirmed = window.confirm(`Restore version "${version}" for baseline "${name}"?`);
  if (!confirmed) {
    return;
  }
  const restoredBy = window.prompt("Restored by", "dashboard-user") || "dashboard-user";
  await postJson("/api/baseline/restore", {
    name,
    version,
    restored_by: restoredBy,
  });
  writeConsole(`Restored ${name} to version ${version}.`, "replace");
  state.baselineCache.delete(name);
  await refreshDashboard();
  await selectBaseline(name, { prefill: false });
}

async function getBaselineDetails(name) {
  if (!name) {
    return null;
  }
  if (!state.baselineCache.has(name)) {
    const payload = await fetchJson(`/api/baseline?id=${encodeURIComponent(name)}`);
    state.baselineCache.set(name, payload);
  }
  return state.baselineCache.get(name);
}

function prefillFormsFromBaseline(detail) {
  if (!detail) {
    return;
  }
  const capture = detail.capture || {};
  const compareSelect = document.getElementById("compare-baseline-select");
  const updateSelect = document.getElementById("update-baseline-select");
  compareSelect.value = detail.name;
  updateSelect.value = detail.name;

  const updateForm = document.querySelector('[data-action-form="update-baseline"]');
  const compareForm = document.querySelector('[data-action-form="compare"]');
  updateForm.elements.url.value = capture.url || "";
  updateForm.elements.browser.value = capture.browser || "chromium";
  updateForm.elements.device.value = capture.device || "";
  updateForm.elements.locale.value = capture.locale || "";
  compareForm.elements.url.value = capture.url || compareForm.elements.url.value;
  compareForm.querySelectorAll('input[name="browsers"]').forEach((checkbox) => {
    checkbox.checked = checkbox.value === (capture.browser || "chromium");
  });
  compareForm.querySelectorAll('input[name="devices"]').forEach((checkbox) => {
    const compareValue = capture.device || "desktop";
    checkbox.checked = checkbox.value === compareValue;
  });
  compareForm.querySelectorAll('input[name="locales"]').forEach((checkbox) => {
    checkbox.checked = Boolean(capture.locale) && checkbox.value === capture.locale;
  });
  if (capture.viewport) {
    const viewportText = `${capture.viewport[0]}x${capture.viewport[1]}`;
    updateForm.elements.viewport.value = viewportText;
    compareForm.elements.viewport.value = viewportText;
  }
  updateCompareCount();
}

async function selectBaseline(name, options = {}) {
  const detail = await getBaselineDetails(name);
  state.selectedBaseline = detail;
  renderBaselineDetail(detail);
  renderBaselines(state.dashboard?.baselines || []);
  if (!options.silent) {
    setActiveView("view-baselines");
  }
  if (options.prefill) {
    prefillFormsFromBaseline(detail);
  }
}

async function selectRun(runId) {
  const payload = await fetchJson(`/api/run?id=${encodeURIComponent(runId)}`);
  payload.run = runId;
  const baselineDetails = payload.baseline_name ? await getBaselineDetails(payload.baseline_name) : null;
  if (baselineDetails) {
    state.selectedBaseline = baselineDetails;
    renderBaselineDetail(baselineDetails);
  }
  setActiveView("view-results");
  renderDetail(payload, baselineDetails);
}

async function runAction(action, payload = {}) {
  writeConsole(`Running ${action}...`, "replace");
  try {
    const result = await fetchJson(`/api/actions/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const logParts = [
      `Action: ${action}`,
      `Return code: ${result.returncode}`,
      "",
      "stdout:",
      result.stdout || "(empty)",
      "",
      "stderr:",
      result.stderr || "(empty)",
    ];
    writeConsole(logParts.join("\n"), "replace");
    await refreshDashboard();
    return result;
  } catch (error) {
    writeConsole(error.message || String(error), "replace");
    throw error;
  }
}

async function submitActionForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const action = form.getAttribute("data-action-form");
  const payload = formToPayload(form);
  setActionFormState(form, true, actionProgressLabel(action, "start"));
  let result;
  try {
    setActionFormState(form, true, actionProgressLabel(action, "progress"));
    result = await runAction(action, payload);
  } catch (error) {
    setActionFormState(form, false, error.message || actionProgressLabel(action, "error"), "error");
    return;
  }
  if (action === "compare" && result.returncode === 0) {
    setActiveView("view-results");
    const latest = state.dashboard?.runs?.[0];
    if (latest) {
      await selectRun(latest.run);
    }
  }
  if ((action === "create-baseline" || action === "update-baseline") && payload.name) {
    state.baselineCache.delete(payload.name);
    await selectBaseline(payload.name, { prefill: true });
  }
  if (action === "create-baseline" || action === "update-baseline" || action === "create-multiple-baselines") {
    setActiveTab("actions", "action-compare");
  }
  if (action === "create-multiple-baselines" && result.returncode === 0) {
    setActiveView("view-baselines");
  }
  setActionFormState(
    form,
    false,
    result.returncode === 0 ? actionProgressLabel(action, "success") : actionProgressLabel(action, "error"),
    result.returncode === 0 ? "success" : "error",
  );
}

async function saveDecision(event) {
  event.preventDefault();
  const run = document.getElementById("decision-run-id").value;
  if (!run) {
    writeConsole("Select a run before saving a decision.", "replace");
    return;
  }
  const decider = document.getElementById("decider").value.trim();
  const decision = document.getElementById("decision").value;
  const comment = document.getElementById("comment").value.trim();
  if (!decider) {
    writeConsole("Decider is required.", "replace");
    return;
  }

  try {
    const result = await fetchJson("/api/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run, decider, decision, comment }),
    });
    writeConsole(`Decision saved for ${run}.`, "replace");
    await refreshDashboard();
    await selectRun(run);
    return result;
  } catch (error) {
    writeConsole(error.message || String(error), "replace");
    return null;
  }
}

async function refreshDashboard() {
  const dashboard = await fetchJson("/api/dashboard");
  state.dashboard = dashboard;
  renderMetrics(dashboard);
  renderResultsStrip(dashboard.runs, dashboard.latest_suite);
  renderFilterOptions(dashboard.runs);
  renderBaselines(dashboard.baselines);
  renderModels(dashboard.models);
  renderSummaries(dashboard.recent_summaries || []);
  renderRuns();
  const attentionBadge = document.getElementById("attention-badge");
  if (attentionBadge) {
    attentionBadge.textContent = summarizeAttentionBadge(dashboard.runs || []);
  }

  if (state.selectedRunId) {
    const stillExists = dashboard.runs.find((item) => item.run === state.selectedRunId);
    if (stillExists) {
      await selectRun(state.selectedRunId);
    } else {
      state.selectedRun = null;
      state.selectedRunId = null;
    }
  }

  if (!state.selectedRunId) {
    document.getElementById("run-detail-panel")?.classList.add("hidden");
    document.querySelector(".board-runs")?.classList.remove("has-selection");
  }

  if (state.selectedBaseline) {
    const stillExistsBaseline = dashboard.baselines.find((item) => item.name === state.selectedBaseline?.name);
    if (stillExistsBaseline) {
      await selectBaseline(state.selectedBaseline.name, { prefill: false, silent: true });
    } else {
      state.selectedBaseline = null;
      renderBaselineDetail(null);
    }
  } else {
    renderBaselineDetail(null);
  }
}

function bindStaticEvents() {
  document.getElementById("decision-form").addEventListener("submit", saveDecision);
  document.getElementById("refresh-btn").addEventListener("click", () => refreshDashboard().catch((error) => writeConsole(String(error), "replace")));
  document.getElementById("delete-run-btn").addEventListener("click", () => {
    deleteRun(state.selectedRunId).catch((error) => writeConsole(String(error), "replace"));
  });
  document.getElementById("delete-baseline-btn").addEventListener("click", () => {
    deleteBaseline(state.selectedBaseline?.name).catch((error) => writeConsole(String(error), "replace"));
  });
  document.getElementById("baseline-to-update-btn").addEventListener("click", async () => {
    const selected = document.getElementById("update-baseline-select").value || state.selectedBaseline?.name;
    if (!selected) {
      writeConsole("Select a baseline first.", "replace");
      return;
    }
    await selectBaseline(selected, { prefill: true });
  });
  document.getElementById("prefill-baseline-update").addEventListener("click", async () => {
    const name = state.selectedRun?.baseline_name || state.selectedBaseline?.name;
    if (!name) {
      writeConsole("No baseline is attached to the selected run.", "replace");
      return;
    }
    await selectBaseline(name, { prefill: true });
  });

  document.querySelectorAll("[data-action-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      submitActionForm(event).catch((error) => writeConsole(String(error), "replace"));
    });
  });

  document.querySelectorAll("[data-tab-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.getAttribute("data-tab-group");
      const target = button.getAttribute("data-tab-target");
      if (!group || !target) {
        return;
      }
      setActiveTab(group, target);
    });
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-view-target");
      if (!target) {
        return;
      }
      setActiveView(target);
    });
  });

  ["run-search", "status-filter", "decision-filter", "browser-filter", "device-filter", "locale-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderRuns);
    document.getElementById(id).addEventListener("change", renderRuns);
  });
  document.querySelectorAll('input[name="browsers"], input[name="devices"], input[name="locales"]').forEach((checkbox) => {
    checkbox.addEventListener("change", updateCompareCount);
  });
  document.getElementById("compare-baseline-select").addEventListener("change", async (event) => {
    const name = event.currentTarget.value;
    if (!name) {
      return;
    }
    try {
      const detail = await getBaselineDetails(name);
      prefillFormsFromBaseline(detail);
    } catch (error) {
      writeConsole(String(error), "replace");
    }
  });
  document.getElementById("baseline-search").addEventListener("input", () => {
    renderBaselines(state.dashboard?.baselines || []);
  });
  document.getElementById("lightbox-close").addEventListener("click", closeImageLightbox);
  document.getElementById("image-lightbox").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeImageLightbox();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.lightboxOpen) {
      closeImageLightbox();
    }
  });
}

bindStaticEvents();
setActiveView(state.activeView);
updateCompareCount();
refreshDashboard().catch((error) => writeConsole(String(error), "replace"));

