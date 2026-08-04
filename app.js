const DEFAULT_WEEKS = 4;
const MIN_WEEKS = 1;
const MAX_WEEKS = 10;
const DAYS_PER_WEEK = 7;
const CONTINUOUS_WINDOW_DAYS = 28;
const DEFAULT_TARGET_DAYS = DEFAULT_WEEKS * DAYS_PER_WEEK;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "griddy.habits";
const ARCHIVE_STORAGE_KEY = "griddy.archived";
const GRID_COLUMNS = 7;
const PANEL_VISIBLE_MAX = 560;

const dashboard = document.getElementById("dashboard");
const emptyState = document.getElementById("empty-state");
const addHabitBtn = document.getElementById("add-habit-btn");
const statsBtn = document.getElementById("stats-btn");
const statsModal = document.getElementById("stats-modal");
const statsCloseBtn = document.getElementById("stats-close-btn");
const statsContractsCompleted = document.getElementById("stats-contracts-completed");
const statsCompletionRate = document.getElementById("stats-completion-rate");
const statsLongestStreak = document.getElementById("stats-longest-streak");
const archivedList = document.getElementById("archived-list");
const archivedEmpty = document.getElementById("archived-empty");
const exportBackupBtn = document.getElementById("export-backup-btn");
const importBackupBtn = document.getElementById("import-backup-btn");
const importFileInput = document.getElementById("import-file-input");
const habitModal = document.getElementById("habit-modal");
const habitForm = document.getElementById("habit-form");
const habitTitleInput = document.getElementById("habit-title-input");
const habitWeeksSlider = document.getElementById("habit-weeks-slider");
const sliderValueLabel = document.getElementById("slider-value-label");
const habitCancelBtn = document.getElementById("habit-cancel-btn");
const habitModeFixed = document.getElementById("habit-mode-fixed");
const habitModeContinuous = document.getElementById("habit-mode-continuous");
const fixedDurationFields = document.getElementById("fixed-duration-fields");
const continuousModeHint = document.getElementById("continuous-mode-hint");
const debugNextDayBtn = document.getElementById("debug-next-day-btn");
const deleteConfirmModal = document.getElementById("delete-confirm-modal");
const deleteConfirmMessage = document.getElementById("delete-confirm-message");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");

/**
 * @typedef {'fixed' | 'continuous'} HabitMode
 * @typedef {{
 *   id: string,
 *   title: string,
 *   mode: HabitMode,
 *   days: boolean[],
 *   isCollapsed: boolean,
 *   createdDate: string | null,
 *   windowEndDate: string | null,
 *   currentStreak?: number,
 *   bestStreak?: number,
 *   totalCompletedDays?: number,
 *   totalElapsedDays?: number
 * }} Habit
 * @typedef {{
 *   id: string,
 *   title: string,
 *   mode: HabitMode,
 *   days: boolean[],
 *   createdDate: string | null,
 *   archivedDate: string,
 *   totalDays: number,
 *   completedDays: number,
 *   fulfilled: boolean
 * }} ArchivedHabit
 */

/** @type {Habit[]} */
let habits = [];

/** @type {ArchivedHabit[]} */
let archivedHabits = [];

/** @type {string | null} */
let pendingDeleteHabitId = null;

/** Artificial day offset for local debug simulation. */
let debugDayOffset = 0;

function createEmptyDays(length) {
  return Array.from({ length }, () => false);
}

function normalizeDays(days, fallbackLength = DEFAULT_TARGET_DAYS) {
  if (Array.isArray(days) && days.length > 0) {
    return days.map((day) => Boolean(day));
  }

  return createEmptyDays(fallbackLength);
}

function normalizeCreatedDate(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function startOfLocalDay(date) {
  const localDay = new Date(date);
  localDay.setHours(0, 0, 0, 0);
  return localDay;
}

function getAppToday() {
  const today = new Date();
  today.setDate(today.getDate() + debugDayOffset);
  return startOfLocalDay(today);
}

function isContinuousHabit(habit) {
  return habit.mode === "continuous";
}

function getCurrentDayIndex(habit) {
  if (isContinuousHabit(habit)) {
    // Today is always the last block in the growing or rolling window.
    return Math.max(0, habit.days.length - 1);
  }

  const createdDate = normalizeCreatedDate(habit.createdDate);
  if (!createdDate) {
    return Number.POSITIVE_INFINITY;
  }

  const start = startOfLocalDay(new Date(createdDate));
  const today = getAppToday();
  const elapsedDays = Math.floor((today.getTime() - start.getTime()) / MS_PER_DAY);

  return Math.max(0, elapsedDays);
}

function getContinuousElapsedDays(habit) {
  const today = getAppToday();
  const createdDate = normalizeCreatedDate(habit.createdDate);
  const start = createdDate
    ? startOfLocalDay(new Date(createdDate))
    : today;
  const elapsedDays =
    Math.floor((today.getTime() - start.getTime()) / MS_PER_DAY) + 1;

  return Math.max(1, elapsedDays);
}

function isDayInteractive(habit, dayIndex, currentDayIndex) {
  if (isContinuousHabit(habit)) return true;
  return dayIndex <= currentDayIndex && dayIndex < habit.days.length;
}

function isTodayCell(habit, dayIndex, currentDayIndex, totalDays) {
  if (isContinuousHabit(habit)) {
    return dayIndex === totalDays - 1;
  }

  return dayIndex === currentDayIndex && currentDayIndex < totalDays;
}

function isMissedDay(habit, dayIndex, currentDayIndex) {
  if (habit.days[dayIndex]) return false;
  return dayIndex < currentDayIndex && dayIndex < habit.days.length;
}

function isContractPeriodOver(habit) {
  if (isContinuousHabit(habit)) return false;
  return getCurrentDayIndex(habit) >= habit.days.length;
}

function getContractOutcome(habit) {
  if (isContinuousHabit(habit)) return null;

  const total = habit.days.length;
  if (total === 0) return null;

  const completed = countFilled(habit.days);
  const percent = Math.round((completed / total) * 100);
  const fulfilled = habit.days.every(Boolean);

  if (fulfilled) {
    return {
      status: "fulfilled",
      completed,
      total,
      percent: 100,
    };
  }

  if (isContractPeriodOver(habit)) {
    return {
      status: "expired",
      completed,
      total,
      percent,
    };
  }

  return null;
}

function countFilled(days) {
  return days.filter(Boolean).length;
}

function getTargetDays(habit) {
  return habit.days.length;
}

function calculateCurrentStreak(days) {
  if (!Array.isArray(days) || days.length === 0) return 0;

  let startIndex = days.length - 1;

  // Allow the streak to survive if today is not checked yet.
  if (!days[startIndex] && days.length > 1) {
    startIndex -= 1;
  }

  let streak = 0;
  for (let i = startIndex; i >= 0; i -= 1) {
    if (!days[i]) break;
    streak += 1;
  }

  return streak;
}

function calculateBestStreak(days) {
  if (!Array.isArray(days) || days.length === 0) return 0;

  let longest = 0;
  let current = 0;

  days.forEach((day) => {
    if (day) {
      current += 1;
      longest = Math.max(longest, current);
      return;
    }
    current = 0;
  });

  return longest;
}

function calculateStreaks(habit) {
  const days = habit.days || [];
  const currentStreak = calculateCurrentStreak(days);
  const bestStreak = calculateBestStreak(days);
  const totalCompletedDays = countFilled(days);
  const totalElapsedDays = getContinuousElapsedDays(habit);

  habit.currentStreak = currentStreak;
  habit.bestStreak = bestStreak;
  habit.totalCompletedDays = totalCompletedDays;
  habit.totalElapsedDays = totalElapsedDays;

  return {
    currentStreak,
    bestStreak,
    totalCompletedDays,
    totalElapsedDays,
  };
}

function calculateStreak(habit) {
  return calculateCurrentStreak(habit.days);
}

function syncHabitStreaks(habit) {
  if (!isContinuousHabit(habit)) return;
  calculateStreaks(habit);
}

function formatStreakLabel(habit) {
  const {
    currentStreak,
    bestStreak,
    totalCompletedDays,
    totalElapsedDays,
  } = calculateStreaks(habit);

  return `🔥 ${currentStreak} | ⚡ Best: ${bestStreak} | 🎯 ${totalCompletedDays} / ${totalElapsedDays} Days`;
}

function renderStreakBadgeContent(badge, habit) {
  const {
    currentStreak,
    bestStreak,
    totalCompletedDays,
    totalElapsedDays,
  } = calculateStreaks(habit);

  badge.replaceChildren();

  const current = document.createElement("span");
  current.className = "streak-badge__item";
  current.innerHTML = `🔥 <span class="streak-badge__value">${currentStreak}</span>`;

  const divider1 = document.createElement("span");
  divider1.className = "streak-badge__divider";
  divider1.textContent = "|";

  const best = document.createElement("span");
  best.className = "streak-badge__item";
  best.innerHTML = `⚡ Best: <span class="streak-badge__value">${bestStreak}</span>`;

  const divider2 = document.createElement("span");
  divider2.className = "streak-badge__divider";
  divider2.textContent = "|";

  const progress = document.createElement("span");
  progress.className = "streak-badge__item";
  progress.innerHTML = `🎯 <span class="streak-badge__value">${totalCompletedDays}</span><span class="streak-badge__muted"> / ${totalElapsedDays} Days</span>`;

  badge.append(current, divider1, best, divider2, progress);
  badge.setAttribute("aria-label", formatStreakLabel(habit));
  badge.classList.toggle("is-zero", currentStreak === 0);
}

function estimatePanelMaxHeight(dayCount) {
  const rows = Math.max(1, Math.ceil(dayCount / GRID_COLUMNS));
  const rowPitch = 48;
  const estimated = rows * rowPitch + 12;
  return `${Math.min(Math.max(estimated, 200), PANEL_VISIBLE_MAX)}px`;
}

function clampWeeks(rawValue) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WEEKS;
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, parsed));
}

function weeksToDays(weeks) {
  return clampWeeks(weeks) * DAYS_PER_WEEK;
}

function formatWeekLabel(weeks) {
  const safeWeeks = clampWeeks(weeks);
  const days = weeksToDays(safeWeeks);
  const weekWord = safeWeeks === 1 ? "Week" : "Weeks";
  return `${safeWeeks} ${weekWord} (${days} days)`;
}

function ensureWeeklyLength(dayCount) {
  const parsed = Number.parseInt(String(dayCount), 10);
  if (!Number.isFinite(parsed) || parsed < DAYS_PER_WEEK) {
    return DEFAULT_TARGET_DAYS;
  }

  return parsed - (parsed % DAYS_PER_WEEK) || DEFAULT_TARGET_DAYS;
}

function syncContinuousHabitWindow(habit) {
  if (!isContinuousHabit(habit)) return;

  const today = getAppToday();
  const elapsedDays = getContinuousElapsedDays(habit);
  let days = Array.isArray(habit.days)
    ? habit.days.map((day) => Boolean(day))
    : [];

  const windowEnd = normalizeCreatedDate(habit.windowEndDate)
    ? startOfLocalDay(new Date(habit.windowEndDate))
    : today;
  const shift = Math.floor((today.getTime() - windowEnd.getTime()) / MS_PER_DAY);

  if (elapsedDays < CONTINUOUS_WINDOW_DAYS) {
    // Growing phase: show only days that have existed since creation.
    const targetLength = elapsedDays;

    if (days.length > targetLength) {
      days = days.slice(-targetLength);
    }

    while (days.length < targetLength) {
      days.push(false);
    }
  } else {
    // Rolling phase: fixed 28-day window ending on today.
    if (days.length > CONTINUOUS_WINDOW_DAYS) {
      days = days.slice(-CONTINUOUS_WINDOW_DAYS);
    }

    while (days.length < CONTINUOUS_WINDOW_DAYS) {
      days.push(false);
    }

    if (shift > 0) {
      if (shift >= CONTINUOUS_WINDOW_DAYS) {
        days = createEmptyDays(CONTINUOUS_WINDOW_DAYS);
      } else {
        days = days.slice(shift).concat(createEmptyDays(shift));
      }
    }

    if (days.length > CONTINUOUS_WINDOW_DAYS) {
      days = days.slice(-CONTINUOUS_WINDOW_DAYS);
    }
  }

  habit.days = days;
  habit.windowEndDate = today.toISOString();
  calculateStreaks(habit);
}

function saveHabits() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}

function saveArchivedHabits() {
  localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archivedHabits));
}

function loadArchivedHabits() {
  try {
    const raw = localStorage.getItem(ARCHIVE_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && typeof item.title === "string")
      .map((item) => {
        const days = normalizeDays(item.days, DEFAULT_TARGET_DAYS);
        const totalDays =
          Number(item.totalDays) || (days.length > 0 ? days.length : 0);
        const completedDays =
          Number(item.completedDays) || countFilled(days);
        const fulfilled =
          typeof item.fulfilled === "boolean"
            ? item.fulfilled
            : totalDays > 0 && completedDays === totalDays;

        return {
          id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
          title: item.title.trim() || "Untitled",
          mode: item.mode === "continuous" ? "continuous" : "fixed",
          days,
          createdDate: normalizeCreatedDate(item.createdDate),
          archivedDate:
            normalizeCreatedDate(item.archivedDate) || new Date().toISOString(),
          totalDays,
          completedDays,
          fulfilled,
        };
      });
  } catch {
    return [];
  }
}

function isFixedContractComplete(habit) {
  const outcome = getContractOutcome(habit);
  return outcome?.status === "fulfilled";
}

function isFixedContractExpired(habit) {
  const outcome = getContractOutcome(habit);
  return outcome?.status === "expired";
}

function getMaxConsecutiveCompleted(days) {
  return calculateBestStreak(days);
}

function getElapsedDayStats(habit) {
  if (isContinuousHabit(habit)) {
    return {
      completed: countFilled(habit.days),
      elapsed: habit.days.length,
    };
  }

  const currentDayIndex = getCurrentDayIndex(habit);
  const elapsedCount = Number.isFinite(currentDayIndex)
    ? Math.min(Math.max(currentDayIndex + 1, 0), habit.days.length)
    : habit.days.length;

  let completed = 0;
  for (let i = 0; i < elapsedCount; i += 1) {
    if (habit.days[i]) completed += 1;
  }

  return {
    completed,
    elapsed: elapsedCount,
  };
}

function computeGlobalStats() {
  let completedElapsedDays = 0;
  let totalElapsedDays = 0;
  let longestStreak = 0;
  let contractsCompleted = 0;

  habits.forEach((habit) => {
    if (isContinuousHabit(habit)) syncContinuousHabitWindow(habit);

    const elapsedStats = getElapsedDayStats(habit);
    completedElapsedDays += elapsedStats.completed;
    totalElapsedDays += elapsedStats.elapsed;

    if (isContinuousHabit(habit)) {
      calculateStreaks(habit);
      longestStreak = Math.max(
        longestStreak,
        Number(habit.bestStreak) || calculateBestStreak(habit.days)
      );
    }
  });

  archivedHabits.forEach((entry) => {
    const days = Array.isArray(entry.days) ? entry.days : [];
    const completed = entry.completedDays || countFilled(days);
    const elapsed = entry.totalDays || days.length;

    completedElapsedDays += completed;
    totalElapsedDays += elapsed;
    longestStreak = Math.max(longestStreak, getMaxConsecutiveCompleted(days));

    if (entry.fulfilled || (elapsed > 0 && completed === elapsed)) {
      contractsCompleted += 1;
    }
  });

  const completionRate =
    totalElapsedDays === 0
      ? 0
      : Math.round((completedElapsedDays / totalElapsedDays) * 100);

  return {
    contractsCompleted,
    completionRate,
    longestStreak,
  };
}

function formatArchiveDate(isoDate) {
  const parsed = normalizeCreatedDate(isoDate);
  if (!parsed) return "Unknown date";
  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderStatsModal() {
  const stats = computeGlobalStats();
  statsContractsCompleted.textContent = String(stats.contractsCompleted);
  statsCompletionRate.textContent = `${stats.completionRate}%`;
  statsLongestStreak.textContent = `🔥 ${stats.longestStreak}`;

  archivedList.replaceChildren();
  archivedEmpty.hidden = archivedHabits.length > 0;

  archivedHabits
    .slice()
    .sort((a, b) => String(b.archivedDate).localeCompare(String(a.archivedDate)))
    .forEach((entry) => {
      const isFulfilled =
        entry.fulfilled ||
        (entry.totalDays > 0 && entry.completedDays === entry.totalDays);

      const item = document.createElement("article");
      item.className = `archived-item${isFulfilled ? " is-fulfilled" : " is-expired"}`;

      const text = document.createElement("div");
      const title = document.createElement("p");
      title.className = "archived-item__title";
      title.textContent = entry.title;

      const meta = document.createElement("p");
      meta.className = "archived-item__meta";
      const percent =
        entry.totalDays > 0
          ? Math.round((entry.completedDays / entry.totalDays) * 100)
          : 0;
      meta.textContent = isFulfilled
        ? `${entry.completedDays}/${entry.totalDays} days · ${formatArchiveDate(entry.archivedDate)}`
        : `${entry.completedDays}/${entry.totalDays} days (${percent}%) · ${formatArchiveDate(entry.archivedDate)}`;

      text.append(title, meta);

      const badge = document.createElement("span");
      badge.className = isFulfilled
        ? "archived-item__badge archived-item__badge--trophy"
        : "archived-item__badge archived-item__badge--expired";
      badge.setAttribute(
        "aria-label",
        isFulfilled ? "Fulfilled contract" : "Expired contract"
      );
      badge.textContent = isFulfilled ? "🏆" : "❌";

      item.append(text, badge);
      archivedList.appendChild(item);
    });
}

function openStatsModal() {
  renderStatsModal();
  statsModal.hidden = false;
  statsModal.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => {
    statsCloseBtn.focus();
  });
}

function closeStatsModal() {
  statsModal.hidden = true;
  statsModal.setAttribute("aria-hidden", "true");
  statsBtn.focus();
}

function formatBackupFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `griddy-backup-${year}-${month}-${day}.json`;
}

function buildBackupPayload() {
  return {
    app: "GRIDDY",
    version: 1,
    exportedAt: new Date().toISOString(),
    habits,
    archivedHabits,
    settings: {
      debugDayOffset,
    },
  };
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const payload = buildBackupPayload();
  downloadJsonFile(formatBackupFilename(), payload);
}

function isValidBackupPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (!Array.isArray(data.habits)) return false;
  if (
    data.archivedHabits !== undefined &&
    !Array.isArray(data.archivedHabits)
  ) {
    return false;
  }

  const appName = typeof data.app === "string" ? data.app.toUpperCase() : "";
  if (appName && appName !== "GRIDDY") return false;

  return data.habits.every(
    (item) => item && typeof item === "object" && typeof item.title === "string"
  );
}

function applyBackupPayload(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.habits));
  localStorage.setItem(
    ARCHIVE_STORAGE_KEY,
    JSON.stringify(Array.isArray(payload.archivedHabits) ? payload.archivedHabits : [])
  );

  const savedOffset = payload.settings?.debugDayOffset;
  debugDayOffset = Number.isFinite(savedOffset)
    ? Math.max(0, Number(savedOffset))
    : 0;

  const restoredHabits = loadHabits();
  habits = Array.isArray(restoredHabits) ? restoredHabits : [];
  archivedHabits = loadArchivedHabits();
  saveHabits();
  saveArchivedHabits();
  renderHabits();
  closeStatsModal();
}

function handleImportFileChange(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      if (!isValidBackupPayload(parsed)) {
        window.alert("Invalid GRIDDY backup file. Please choose a valid JSON backup.");
        return;
      }

      const confirmed = window.confirm(
        "This will replace your current habits with the imported backup. Continue?"
      );
      if (!confirmed) return;

      applyBackupPayload(parsed);
    } catch {
      window.alert("Could not read that backup file. Please try another JSON file.");
    }
  };
  reader.onerror = () => {
    window.alert("Could not read that backup file. Please try again.");
  };
  reader.readAsText(file);
}

function openImportBackupPicker() {
  importFileInput.click();
}

function archiveHabit(habitId) {
  const index = habits.findIndex((habit) => habit.id === habitId);
  if (index === -1) return;

  const habit = habits[index];
  const outcome = getContractOutcome(habit);
  if (!outcome) return;

  /** @type {ArchivedHabit} */
  const archivedEntry = {
    id: habit.id,
    title: habit.title,
    mode: habit.mode,
    days: [...habit.days],
    createdDate: habit.createdDate,
    archivedDate: new Date().toISOString(),
    totalDays: habit.days.length,
    completedDays: countFilled(habit.days),
    fulfilled: outcome.status === "fulfilled",
  };

  archivedHabits.push(archivedEntry);
  habits.splice(index, 1);
  saveHabits();
  saveArchivedHabits();
  renderHabits();
}

function retryChallenge(habitId) {
  const habit = habits.find((entry) => entry.id === habitId);
  if (!habit || isContinuousHabit(habit)) return;

  habit.days = createEmptyDays(habit.days.length);
  habit.createdDate = getAppToday().toISOString();
  habit.windowEndDate = null;
  habit.isCollapsed = false;
  saveHabits();
  renderHabits();
}

function loadHabits() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    return parsed
      .filter((item) => item && typeof item.title === "string")
      .map((item) => {
        const mode = item.mode === "continuous" ? "continuous" : "fixed";
        const fallbackLength = mode === "continuous" ? 1 : DEFAULT_TARGET_DAYS;

        /** @type {Habit} */
        const habit = {
          id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
          title: item.title.trim() || "Untitled",
          mode,
          days: normalizeDays(item.days, fallbackLength),
          isCollapsed: Boolean(item.isCollapsed),
          createdDate: normalizeCreatedDate(item.createdDate),
          windowEndDate: normalizeCreatedDate(item.windowEndDate),
          currentStreak: 0,
          bestStreak: 0,
        };

        if (mode === "continuous") {
          syncContinuousHabitWindow(habit);
          calculateStreaks(habit);
        }

        return habit;
      });
  } catch {
    return null;
  }
}

function updateEmptyState() {
  emptyState.hidden = habits.length > 0;
}

function updateCardProgress(cardEl, habit) {
  if (isContinuousHabit(habit)) {
    const streakEl = cardEl.querySelector("[data-streak]");
    if (streakEl) {
      renderStreakBadgeContent(streakEl, habit);
    }
    return;
  }

  const countEl = cardEl.querySelector("[data-progress]");
  const totalEl = cardEl.querySelector("[data-total]");

  if (countEl) countEl.textContent = String(countFilled(habit.days));
  if (totalEl) totalEl.textContent = String(habit.days.length);
}

function applyCollapsedState(cardEl, habit) {
  const header = cardEl.querySelector(".grid-card__header");
  const panel = cardEl.querySelector(".habit-grid-panel");

  cardEl.classList.toggle("is-collapsed", habit.isCollapsed);

  if (header) {
    header.setAttribute("aria-expanded", String(!habit.isCollapsed));
  }

  if (panel) {
    panel.setAttribute("aria-hidden", String(habit.isCollapsed));
  }
}

function toggleCollapsed(habit, cardEl) {
  habit.isCollapsed = !habit.isCollapsed;
  applyCollapsedState(cardEl, habit);
  saveHabits();
}

function deleteHabit(habitId) {
  const index = habits.findIndex((habit) => habit.id === habitId);
  if (index === -1) return;

  habits.splice(index, 1);
  saveHabits();
  renderHabits();
}

function openDeleteConfirmModal(habit) {
  pendingDeleteHabitId = habit.id;
  deleteConfirmMessage.innerHTML = `Are you sure you want to delete "<strong></strong>"? This action cannot be undone.`;
  const titleEl = deleteConfirmMessage.querySelector("strong");
  if (titleEl) titleEl.textContent = habit.title;

  deleteConfirmModal.hidden = false;
  deleteConfirmModal.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => {
    deleteCancelBtn.focus();
  });
}

function closeDeleteConfirmModal() {
  pendingDeleteHabitId = null;
  deleteConfirmModal.hidden = true;
  deleteConfirmModal.setAttribute("aria-hidden", "true");
  deleteConfirmMessage.textContent =
    "Are you sure you want to delete this habit? This action cannot be undone.";
}

function confirmPendingDelete() {
  if (!pendingDeleteHabitId) {
    closeDeleteConfirmModal();
    return;
  }

  const habitId = pendingDeleteHabitId;
  closeDeleteConfirmModal();
  deleteHabit(habitId);
}

function buildGrid(habit) {
  if (isContinuousHabit(habit)) {
    syncContinuousHabitWindow(habit);
  }

  const targetDays = getTargetDays(habit);
  const currentDayIndex = getCurrentDayIndex(habit);
  const grid = document.createElement("div");
  grid.className = "habit-grid";
  grid.setAttribute("role", "grid");
  grid.setAttribute(
    "aria-label",
    isContinuousHabit(habit)
      ? `${habit.title} rolling 28 day progress grid`
      : `${habit.title} ${targetDays} day progress grid`
  );

  for (let i = 0; i < targetDays; i += 1) {
    const cell = document.createElement("button");
    const interactive = isDayInteractive(habit, i, currentDayIndex);
    const today = isTodayCell(habit, i, currentDayIndex, targetDays);
    const missed = isMissedDay(habit, i, currentDayIndex);
    const dayOffset = isContinuousHabit(habit) ? targetDays - 1 - i : i;
    const dayLabel = isContinuousHabit(habit)
      ? dayOffset === 0
        ? "today"
        : dayOffset === 1
          ? "yesterday"
          : `${dayOffset} days ago`
      : `day ${i + 1}`;

    cell.type = "button";
    cell.className = "habit-cell grid-day";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute(
      "aria-label",
      missed
        ? `${habit.title}, ${dayLabel}, missed`
        : `${habit.title}, ${dayLabel}`
    );
    cell.setAttribute("aria-pressed", String(habit.days[i]));

    if (habit.days[i]) cell.classList.add("is-filled");
    if (today) cell.classList.add("today");
    if (missed) cell.classList.add("failed");
    if (!interactive) {
      cell.classList.add("is-future");
      cell.disabled = true;
      cell.setAttribute("aria-disabled", "true");
    }

    cell.addEventListener("click", () => {
      const liveIndex = getCurrentDayIndex(habit);
      if (!isDayInteractive(habit, i, liveIndex)) return;

      habit.days[i] = !habit.days[i];
      cell.classList.toggle("is-filled", habit.days[i]);
      cell.classList.toggle("failed", isMissedDay(habit, i, liveIndex));
      cell.setAttribute("aria-pressed", String(habit.days[i]));

      const cardEl = dashboard.querySelector(`[data-habit-id="${habit.id}"]`);
      if (cardEl) {
        updateCardProgress(cardEl, habit);
        cardEl.replaceWith(renderCard(habit));
      }

      saveHabits();
    });

    grid.appendChild(cell);
  }

  return grid;
}

function saveHabitTitle(habitId, newTitle) {
  const habit = habits.find((entry) => entry.id === habitId);
  if (!habit) return false;

  const trimmed = newTitle.trim();
  if (!trimmed) return false;

  habit.title = trimmed;
  saveHabits();
  renderHabits();
  return true;
}

function enterTitleEditMode(habit, heading, titleEl, editBtn) {
  const form = document.createElement("div");
  form.className = "title-edit-form";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "habit-title-input";
  input.value = habit.title;
  input.maxLength = 60;
  input.setAttribute("aria-label", "Edit habit name");
  input.autocomplete = "off";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "title-save-btn";
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "title-cancel-btn";
  cancelBtn.textContent = "Cancel";

  const exitEditMode = () => {
    form.replaceWith(titleEl, editBtn);
  };

  const commitEdit = () => {
    const nextTitle = input.value.trim();
    if (!nextTitle) {
      input.focus();
      input.classList.add("is-invalid");
      return;
    }
    saveHabitTitle(habit.id, nextTitle);
  };

  saveBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    commitEdit();
  });

  cancelBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    exitEditMode();
  });

  input.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  input.addEventListener("input", () => {
    input.classList.remove("is-invalid");
  });

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      exitEditMode();
    }
  });

  form.append(input, saveBtn, cancelBtn);
  titleEl.replaceWith(form);
  editBtn.remove();
  window.requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function renderCardMeta(habit) {
  if (isContinuousHabit(habit)) {
    const badge = document.createElement("span");
    badge.className = "streak-badge";
    badge.dataset.streak = "";
    renderStreakBadgeContent(badge, habit);
    return badge;
  }

  // Fixed contracts always show completed / total days for the full challenge length.
  const meta = document.createElement("p");
  meta.className = "grid-card__meta";
  const completed = countFilled(habit.days);
  const total = getTargetDays(habit);
  meta.innerHTML = `<span data-progress>${completed}</span> / <span data-total>${total}</span> days`;
  return meta;
}

function renderCard(habit) {
  if (isContinuousHabit(habit)) {
    syncContinuousHabitWindow(habit);
  }

  const targetDays = getTargetDays(habit);

  const card = document.createElement("article");
  card.className = "grid-card";
  card.dataset.habitId = habit.id;
  card.dataset.habitMode = habit.mode;
  card.setAttribute("aria-label", habit.title);

  const header = document.createElement("header");
  header.className = "grid-card__header";
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  header.setAttribute("aria-expanded", String(!habit.isCollapsed));
  header.setAttribute("aria-controls", `grid-panel-${habit.id}`);

  const heading = document.createElement("div");
  heading.className = "grid-card__heading";

  const chevron = document.createElement("span");
  chevron.className = "grid-card__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "↓";

  const title = document.createElement("h2");
  title.className = "grid-card__title";
  title.textContent = habit.title;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "edit-title-btn";
  editBtn.setAttribute("aria-label", `Edit ${habit.title}`);
  editBtn.textContent = "✏️";
  editBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    enterTitleEditMode(habit, heading, title, editBtn);
  });

  heading.append(chevron, title, editBtn);

  const actions = document.createElement("div");
  actions.className = "grid-card__actions";

  const meta = renderCardMeta(habit);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "delete-btn";
  deleteBtn.setAttribute("aria-label", `Delete ${habit.title}`);
  deleteBtn.textContent = "×";
  deleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openDeleteConfirmModal(habit);
  });

  actions.append(meta, deleteBtn);
  header.append(heading, actions);

  header.addEventListener("click", (event) => {
    if (event.target.closest(".delete-btn")) return;
    if (event.target.closest(".edit-title-btn")) return;
    if (event.target.closest(".title-edit-form")) return;
    if (event.target.closest(".archive-btn")) return;
    if (event.target.closest(".retry-btn")) return;
    toggleCollapsed(habit, card);
  });

  header.addEventListener("keydown", (event) => {
    if (event.target.closest(".delete-btn")) return;
    if (event.target.closest(".edit-title-btn")) return;
    if (event.target.closest(".title-edit-form")) return;
    if (event.target.closest(".archive-btn")) return;
    if (event.target.closest(".retry-btn")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleCollapsed(habit, card);
    }
  });

  const panel = document.createElement("div");
  panel.className = "habit-grid-panel";
  panel.id = `grid-panel-${habit.id}`;
  panel.style.setProperty(
    "--grid-panel-max-height",
    estimatePanelMaxHeight(targetDays)
  );
  panel.appendChild(buildGrid(habit));

  card.append(header, panel);

  const outcome = getContractOutcome(habit);
  if (outcome) {
    const banner = document.createElement("div");
    banner.className = `archive-banner outcome-banner outcome-banner--${outcome.status}`;

    if (outcome.status === "fulfilled") {
      const title = document.createElement("p");
      title.className = "outcome-banner__title";
      title.textContent = "Contract Fulfilled 🏆";

      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "archive-btn";
      archiveBtn.textContent = "Archive 🏆";
      archiveBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        archiveHabit(habit.id);
      });

      banner.append(title, archiveBtn);
    } else {
      const title = document.createElement("p");
      title.className = "outcome-banner__title outcome-banner__title--expired";
      title.textContent = "Contract Expired ❌";

      const score = document.createElement("p");
      score.className = "outcome-banner__score";
      score.textContent = `${outcome.completed} / ${outcome.total} days completed (${outcome.percent}%)`;

      const actions = document.createElement("div");
      actions.className = "outcome-banner__actions";

      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "archive-btn archive-btn--muted";
      archiveBtn.textContent = "Archive";
      archiveBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        archiveHabit(habit.id);
      });

      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "retry-btn";
      retryBtn.textContent = "Retry Challenge";
      retryBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        retryChallenge(habit.id);
      });

      actions.append(archiveBtn, retryBtn);
      banner.append(title, score, actions);
    }

    card.appendChild(banner);
  }

  applyCollapsedState(card, habit);

  return card;
}

function getSelectedHabitMode() {
  return habitModeContinuous.checked ? "continuous" : "fixed";
}

function addHabit(title, options = {}) {
  const trimmed = title.trim();
  if (!trimmed) return;

  const mode = options.mode === "continuous" ? "continuous" : "fixed";
  const todayIso = getAppToday().toISOString();

  /** @type {Habit} */
  const habit = {
    id: crypto.randomUUID(),
    title: trimmed,
    mode,
    days:
      mode === "continuous"
        ? createEmptyDays(1)
        : createEmptyDays(ensureWeeklyLength(options.targetDays)),
    isCollapsed: false,
    createdDate: todayIso,
    windowEndDate: mode === "continuous" ? todayIso : null,
    currentStreak: 0,
    bestStreak: 0,
  };

  if (mode === "continuous") {
    calculateStreaks(habit);
  }

  habits.push(habit);
  dashboard.appendChild(renderCard(habit));
  updateEmptyState();

  if (options.persist !== false) {
    saveHabits();
  }
}

function renderDashboard() {
  habits.forEach((habit) => {
    if (isContinuousHabit(habit)) syncContinuousHabitWindow(habit);
  });

  dashboard.replaceChildren();
  habits.forEach((habit) => {
    dashboard.appendChild(renderCard(habit));
  });
  updateEmptyState();
}

function renderHabits() {
  renderDashboard();
}

function simulateNextDay() {
  debugDayOffset += 1;

  habits.forEach((habit) => {
    if (isContinuousHabit(habit)) {
      syncContinuousHabitWindow(habit);
    }
  });

  saveHabits();
  renderHabits();
}

function syncDurationSlider(weeks = habitWeeksSlider.value) {
  const safeWeeks = clampWeeks(weeks);
  habitWeeksSlider.value = String(safeWeeks);
  habitWeeksSlider.setAttribute("aria-valuenow", String(safeWeeks));
  sliderValueLabel.textContent = formatWeekLabel(safeWeeks);
}

function syncHabitModeFields() {
  const continuous = getSelectedHabitMode() === "continuous";
  fixedDurationFields.hidden = continuous;
  continuousModeHint.hidden = !continuous;
  habitWeeksSlider.disabled = continuous;
}

function resetHabitForm() {
  habitForm.reset();
  habitModeFixed.checked = true;
  habitModeContinuous.checked = false;
  syncDurationSlider(DEFAULT_WEEKS);
  syncHabitModeFields();
}

function openHabitModal() {
  resetHabitForm();
  habitModal.hidden = false;
  habitModal.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => {
    habitTitleInput.focus();
  });
}

function closeHabitModal() {
  habitModal.hidden = true;
  habitModal.setAttribute("aria-hidden", "true");
  resetHabitForm();
  addHabitBtn.focus();
}

function submitHabitForm(event) {
  event.preventDefault();

  const trimmedTitle = habitTitleInput.value.trim();
  if (!trimmedTitle) {
    habitTitleInput.focus();
    return;
  }

  const mode = getSelectedHabitMode();
  addHabit(trimmedTitle, {
    mode,
    targetDays: mode === "continuous" ? CONTINUOUS_WINDOW_DAYS : weeksToDays(habitWeeksSlider.value),
  });
  closeHabitModal();
}

function initModalEvents() {
  addHabitBtn.addEventListener("click", openHabitModal);
  habitCancelBtn.addEventListener("click", closeHabitModal);
  habitForm.addEventListener("submit", submitHabitForm);
  habitWeeksSlider.addEventListener("input", () => {
    syncDurationSlider(habitWeeksSlider.value);
  });
  habitModeFixed.addEventListener("change", syncHabitModeFields);
  habitModeContinuous.addEventListener("change", syncHabitModeFields);
  debugNextDayBtn.addEventListener("click", simulateNextDay);

  statsBtn.addEventListener("click", openStatsModal);
  statsCloseBtn.addEventListener("click", closeStatsModal);
  exportBackupBtn.addEventListener("click", exportBackup);
  importBackupBtn.addEventListener("click", openImportBackupPicker);
  importFileInput.addEventListener("change", handleImportFileChange);

  deleteCancelBtn.addEventListener("click", closeDeleteConfirmModal);
  deleteConfirmBtn.addEventListener("click", confirmPendingDelete);

  habitModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-modal-dismiss]")) {
      closeHabitModal();
    }
  });

  deleteConfirmModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-delete-modal-dismiss]")) {
      closeDeleteConfirmModal();
    }
  });

  statsModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-stats-modal-dismiss]")) {
      closeStatsModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (!deleteConfirmModal.hidden) {
      closeDeleteConfirmModal();
      return;
    }

    if (!statsModal.hidden) {
      closeStatsModal();
      return;
    }

    if (!habitModal.hidden) {
      closeHabitModal();
    }
  });
}

function init() {
  initModalEvents();
  syncDurationSlider(DEFAULT_WEEKS);
  syncHabitModeFields();

  const savedHabits = loadHabits();
  habits = Array.isArray(savedHabits) ? savedHabits : [];
  archivedHabits = loadArchivedHabits();
  saveHabits();
  saveArchivedHabits();
  renderDashboard();
}

init();
