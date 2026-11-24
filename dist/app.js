const SELECTED_DECK_KEY = "karten-selected-deck";
const DECKS = {
  a2: { name: "German A2", data: "./data/cards.json", count: 171 },
  b1: { name: "German B1", data: "./data/b1-cards.json", count: 2632 },
};
let initialDeckKey = "a2";
try {
  if (localStorage.getItem(SELECTED_DECK_KEY) === "b1") initialDeckKey = "b1";
} catch {
  // Use A2 when browser storage is unavailable.
}

const state = {
  deckKey: initialDeckKey,
  cards: [],
  session: [],
  sessionScope: "all",
  sessionIndex: 0,
  sessionAnswered: 0,
  currentOptions: [],
  answered: false,
  sortAscending: true,
  soundOn: true,
  repeatScheduled: new Set(),
  selectedCardIds: new Set(),
  activeTabId: "main",
  practiceTabs: [],
  tabSessions: {},
  progress: {},
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(`karten-german-${state.deckKey}-progress`) || "{}");
  } catch {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(`karten-german-${state.deckKey}-progress`, JSON.stringify(state.progress));
  refreshStats();
}

function createMainTab() {
  return { id: "main", label: "Study", type: "main", cardIds: null };
}

function getActiveTab() {
  return state.practiceTabs.find((tab) => tab.id === state.activeTabId) || state.practiceTabs[0] || null;
}

function getTabCards(tab) {
  if (!tab || tab.type === "main") return state.cards;
  const cardIds = new Set(tab.cardIds || []);
  return state.cards.filter((card) => cardIds.has(card.id));
}

function getSessionSnapshot() {
  return {
    sessionIds: state.session.map((card) => card.id),
    sessionIndex: state.sessionIndex,
    sessionAnswered: state.sessionAnswered,
    repeatScheduled: [...state.repeatScheduled],
  };
}

function persistActiveTabSession() {
  if (!state.activeTabId || !state.session.length) return;
  state.tabSessions[state.activeTabId] = getSessionSnapshot();
}

function saveSessionState() {
  try {
    persistActiveTabSession();
    localStorage.setItem(`karten-german-${state.deckKey}-tabs`, JSON.stringify({
      activeTabId: state.activeTabId,
      tabs: state.practiceTabs,
      sessions: state.tabSessions,
    }));
  } catch {
    // The app can still be used if browser storage is unavailable.
  }
}

function restoreTabSession(tab, saved) {
  if (!tab || !saved?.sessionIds?.length) return false;
  const cardsById = new Map(state.cards.map((card) => [card.id, card]));
  const restored = saved.sessionIds.map((id) => cardsById.get(id)).filter(Boolean);
  if (!restored.length) return false;
  const restoredIds = new Set(restored.map((card) => card.id));
  state.sessionScope = tab.type === "selected" ? "selected" : "all";
  state.session = state.sessionScope === "selected"
    ? restored
    : [...restored, ...state.cards.filter((card) => !restoredIds.has(card.id))];
  state.selectedCardIds.clear();
  state.sessionIndex = Math.min(Math.max(Number(saved.sessionIndex) || 0, 0), state.session.length);
  state.sessionAnswered = Math.max(Number(saved.sessionAnswered) || 0, 0);
  state.repeatScheduled = new Set(saved.repeatScheduled || []);
  state.answered = false;
  renderCard();
  return true;
}

function restoreSessionState() {
  try {
    const savedTabs = JSON.parse(localStorage.getItem(`karten-german-${state.deckKey}-tabs`) || "null");
    if (Array.isArray(savedTabs?.tabs) && savedTabs.tabs.length) {
      const savedMain = savedTabs.tabs.find((tab) => tab.id === "main") || createMainTab();
      const savedSelected = savedTabs.tabs
        .filter((tab) => tab.id !== "main" && tab.type === "selected")
        .map((tab, index) => ({
          id: String(tab.id),
          label: String(tab.label || `Selected test ${index + 1}`),
          type: "selected",
          cardIds: state.cards.filter((card) => (tab.cardIds || []).includes(card.id)).map((card) => card.id),
        }))
        .filter((tab) => tab.cardIds.length);
      state.practiceTabs = [createMainTab(), ...savedSelected];
      state.tabSessions = savedTabs.sessions && typeof savedTabs.sessions === "object" ? savedTabs.sessions : {};
      state.activeTabId = state.practiceTabs.some((tab) => tab.id === savedTabs.activeTabId)
        ? savedTabs.activeTabId
        : "main";
      const activeTab = getActiveTab();
      if (restoreTabSession(activeTab, state.tabSessions[state.activeTabId])) return true;
      return false;
    }

    const legacy = JSON.parse(localStorage.getItem(`karten-german-${state.deckKey}-session`) || "null");
    state.practiceTabs = [createMainTab()];
    state.tabSessions = {};
    state.activeTabId = "main";
    if (!legacy?.sessionIds?.length) return false;

    const legacyScope = legacy.sessionScope === "selected" ? "selected" : "all";
    const legacyIds = Array.isArray(legacy.focusedTestCardIds) && legacy.focusedTestCardIds.length
      ? legacy.focusedTestCardIds
      : legacyScope === "selected" ? legacy.sessionIds : [];
    const selectedIds = state.cards.filter((card) => legacyIds.includes(card.id)).map((card) => card.id);
    if (selectedIds.length) {
      const migratedTab = { id: `test-migrated-${Date.now()}`, label: "Selected test 1", type: "selected", cardIds: selectedIds };
      state.practiceTabs.push(migratedTab);
      if (legacyScope === "selected") {
        state.activeTabId = migratedTab.id;
        state.tabSessions[migratedTab.id] = legacy;
      }
    }
    if (legacyScope === "all") state.tabSessions.main = legacy;
    return restoreTabSession(getActiveTab(), state.tabSessions[state.activeTabId]);
  } catch {
    state.practiceTabs = [createMainTab()];
    state.tabSessions = {};
    state.activeTabId = "main";
    return false;
  }
}

function updateDeckUi() {
  const deck = DECKS[state.deckKey];
  $("#brandDeckSubtitle").textContent = deck.name;
  $("#deckBreadcrumb").textContent = deck.name;
  $("#activeDeckTitle").textContent = `${deck.name} vocabulary`;
  $("#deckSelect").value = state.deckKey;
  $("#libraryCountLabel").textContent = `${state.cards.length.toLocaleString()} cards`;
  $("#navBrowseCount").textContent = state.cards.length.toLocaleString();
  $$(".deck-option").forEach((button) => {
    const selected = button.dataset.deck === state.deckKey;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

async function loadDeck(deckKey, notify = false) {
  const deck = DECKS[deckKey];
  if (!deck) return;
  const response = await fetch(deck.data);
  state.deckKey = deckKey;
  state.cards = await response.json();
  state.selectedCardIds = new Set();
  state.practiceTabs = [];
  state.tabSessions = {};
  state.activeTabId = "main";
  state.progress = loadProgress();
  updateDeckUi();
  const restored = restoreSessionState();
  if (!restored) startSession();
  else showToast("Progress restored");
  renderPracticeTab();
  refreshStats();
  if (notify) {
    showView("study");
    showToast(`${deck.name} selected`);
  }
}

async function selectDeck(deckKey) {
  if (!DECKS[deckKey] || deckKey === state.deckKey) return;
  try {
    localStorage.setItem(SELECTED_DECK_KEY, deckKey);
  } catch {
    // The deck can still be switched for this visit.
  }
  await loadDeck(deckKey, true);
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function startSession() {
  const tab = getActiveTab() || createMainTab();
  if (!state.practiceTabs.length) state.practiceTabs = [tab];
  state.session = shuffle(getTabCards(tab));
  state.sessionScope = tab.type === "selected" ? "selected" : "all";
  state.sessionIndex = 0;
  state.sessionAnswered = 0;
  state.answered = false;
  state.repeatScheduled = new Set();
  renderCard();
  saveSessionState();
  renderPracticeTab();
}

function startSelectedTest() {
  if (getActiveTab()?.type !== "main") {
    showToast("Open the Study tab to create a new tab");
    return;
  }
  const selectedCards = state.cards.filter((card) => state.selectedCardIds.has(card.id));
  if (!selectedCards.length) {
    showToast("Select at least one card first");
    return;
  }
  saveSessionState();
  const testNumber = state.practiceTabs.filter((tab) => tab.type === "selected").length + 1;
  const tab = {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: `Selected test ${testNumber}`,
    type: "selected",
    cardIds: selectedCards.map((card) => card.id),
  };
  state.practiceTabs.push(tab);
  state.activeTabId = tab.id;
  state.selectedCardIds.clear();
  startSession();
  renderLibrary();
  renderPracticeTab();
  showView("study");
  showToast(`Test started with ${selectedCards.length} cards`);
}

function activateTab(tabId) {
  const tab = state.practiceTabs.find((item) => item.id === tabId);
  if (!tab) return;
  if (state.activeTabId !== tab.id) {
    saveSessionState();
    state.activeTabId = tab.id;
    state.selectedCardIds.clear();
    if (!restoreTabSession(tab, state.tabSessions[tab.id])) startSession();
  }
  renderPracticeTab();
  showView("study");
}

function closeTab(tabId) {
  const tab = state.practiceTabs.find((item) => item.id === tabId);
  if (!tab || tab.type === "main") return;
  const wasActive = state.activeTabId === tabId;
  if (wasActive) saveSessionState();
  state.practiceTabs = state.practiceTabs.filter((item) => item.id !== tabId);
  delete state.tabSessions[tabId];
  if (wasActive) {
    state.activeTabId = "main";
    state.selectedCardIds.clear();
    if (!restoreTabSession(getActiveTab(), state.tabSessions.main)) startSession();
  }
  saveSessionState();
  renderPracticeTab();
  renderLibrary();
  showView("study");
  showToast("Selected test tab closed");
}

function buildOptions(card) {
  const otherMeanings = shuffle(state.cards.filter((item) => item.id !== card.id)).slice(0, 3).map((item) => item.english);
  return shuffle([card.english, ...otherMeanings]);
}

function renderCard() {
  const card = state.session[state.sessionIndex];
  if (!card) {
    renderCompletion();
    return;
  }

  state.answered = false;
  state.currentOptions = buildOptions(card);
  $("#cardNumber").textContent = `CARD ${String(card.number).padStart(3, "0")}`;
  $("#germanWord").textContent = card.german;
  $("#wordForms").textContent = card.forms || "A2 vocabulary in context";
  $("#germanSentence").textContent = card.sentenceDe || "Practice this word in a sentence.";
  $("#answerFeedback").textContent = "";
  $("#answerFeedback").className = "answer-feedback";
  $("#skipButton").textContent = "Skip card";
  setReviewControls(false);
  $("#progressCurrent").textContent = String(state.sessionIndex + 1);
  $("#progressTotal").textContent = String(state.session.length);
  $("#progressPercent").textContent = `${Math.round((state.sessionIndex / state.session.length) * 100)}%`;
  $("#progressFill").style.width = `${(state.sessionIndex / state.session.length) * 100}%`;
  renderOptions();
  updateGoal();
}

function renderOptions() {
  const options = $("#options");
  options.innerHTML = "";
  state.currentOptions.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-button";
    button.dataset.index = String(index);
    button.innerHTML = `<span class="option-number">${index + 1}</span><span></span>`;
    button.querySelector("span:last-child").textContent = option;
    button.addEventListener("click", () => answer(index));
    options.appendChild(button);
  });

  const unknownButton = document.createElement("button");
  unknownButton.type = "button";
  unknownButton.className = "option-button dont-know-option";
  unknownButton.dataset.unknown = "true";
  unknownButton.innerHTML = `<span class="option-number">?</span><span>I don't know</span>`;
  unknownButton.addEventListener("click", () => answer(null, true));
  options.appendChild(unknownButton);
}

function answer(optionIndex, choseUnknown = false) {
  if (state.answered) return;
  const card = state.session[state.sessionIndex];
  if (!card) return;
  state.answered = true;
  state.sessionAnswered += 1;
  const selected = choseUnknown ? null : state.currentOptions[optionIndex];
  const correct = selected === card.english;
  const record = state.progress[card.id] || { attempts: 0, correct: 0 };
  record.attempts += 1;
  if (correct) record.correct += 1;
  record.lastSeen = Date.now();
  state.progress[card.id] = record;
  saveProgress();
  saveSessionState();

  $$(".option-button").forEach((button, index) => {
    button.disabled = true;
    if (button.dataset.unknown === "true") {
      if (choseUnknown) button.classList.add("selected-unknown");
      return;
    }
    if (state.currentOptions[index] === card.english) button.classList.add("correct");
    if (index === optionIndex && !correct) button.classList.add("incorrect");
  });

  const feedback = $("#answerFeedback");
  feedback.className = `answer-feedback ${correct ? "success" : "error"}`;
  feedback.textContent = correct
    ? "Correct. Nice recall."
    : choseUnknown
      ? `No worries. The answer is “${card.english}”. Read it once, then try the next card.`
      : `The answer is “${card.english}”. Read it once, then try the next card.`;
  $("#skipButton").textContent = "Next card";
  setReviewControls(true);
  updateGoal();
}

function setReviewControls(enabled) {
  $$(".review-button").forEach((button) => { button.disabled = !enabled; });
  $("#reviewHint").textContent = enabled ? "Rate it, then continue" : "Choose an answer first";
}

function rateCard(rating) {
  if (!state.answered) return;
  const card = state.session[state.sessionIndex];
  if (!card) return;
  const record = state.progress[card.id] || { attempts: 0, correct: 0 };
  record.lastRating = rating;
  record.lastSeen = Date.now();
  state.progress[card.id] = record;
  saveProgress();
  if (!state.repeatScheduled.has(card.id)) {
    const repeatGap = { again: 0, hard: 2, good: 6, easy: 12 }[rating] ?? 0;
    const repeatAt = Math.min(state.sessionIndex + repeatGap + 1, state.session.length);
    state.session.splice(repeatAt, 0, card);
    state.repeatScheduled.add(card.id);
    showToast(`${rating[0].toUpperCase()}${rating.slice(1)} — repeating ${repeatGap === 0 ? "next" : `in ${repeatGap + 1} cards`}`);
  }
  advanceCard();
}

function advanceCard() {
  state.sessionIndex += 1;
  renderCard();
  saveSessionState();
}

function renderCompletion() {
  $("#progressCurrent").textContent = String(state.session.length);
  $("#progressTotal").textContent = String(state.session.length);
  $("#progressPercent").textContent = "100%";
  $("#progressFill").style.width = "100%";
  $("#germanWord").textContent = "Gut gemacht.";
  $("#wordForms").textContent = "Session complete · you showed up today";
  $("#germanSentence").textContent = "Small, consistent practice is how a language becomes yours.";
  $("#cardNumber").textContent = "SESSION COMPLETE";
  $("#answerFeedback").textContent = `${state.sessionAnswered} cards answered. Your progress is saved on this device.`;
  $("#answerFeedback").className = "answer-feedback success";
  setReviewControls(false);
  const isSelectedTab = state.sessionScope === "selected";
  $("#reviewHint").textContent = isSelectedTab ? "Repeat this selected test" : "Start another full deck review";
  $("#options").innerHTML = `<button class="option-button correct" id="newSessionButton" type="button"><span class="option-number">↻</span><span>${isSelectedTab ? "Repeat selected test" : "Start a new session"}</span></button>`;
  $("#newSessionButton").addEventListener("click", startSession);
  $("#skipButton").textContent = "Review again";
  $("#reviewModeLabel").textContent = "Session complete";
  $("#goalRing").style.background = "conic-gradient(var(--coral) 0deg, var(--coral) 360deg, #efd5cc 360deg)";
  $("#goalPercent").textContent = "100%";
  $("#goalDone").textContent = String(state.sessionAnswered);
  $("#goalLeft").textContent = "0";
}

function updateGoal() {
  const current = Math.min(state.sessionIndex, state.session.length);
  const percent = state.session.length ? Math.round((current / state.session.length) * 100) : 0;
  const angle = percent * 3.6;
  $("#goalRing").style.background = `conic-gradient(var(--coral) 0deg, var(--coral) ${angle}deg, #efd5cc ${angle}deg, #efd5cc 360deg)`;
  $("#goalPercent").textContent = `${percent}%`;
  $("#goalDone").textContent = String(current);
  $("#goalLeft").textContent = String(Math.max(state.session.length - current, 0));
  const scopeLabel = state.sessionScope === "selected" ? "Selected test · " : "";
  $("#reviewModeLabel").textContent = `${scopeLabel}${Math.max(state.session.length - current, 0)} cards in this session`;
}

function getStats() {
  const records = Object.values(state.progress);
  const learned = records.filter((record) => record.correct > 0).length;
  const attempts = records.reduce((sum, record) => sum + record.attempts, 0);
  const correct = records.reduce((sum, record) => sum + record.correct, 0);
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : null;
  return { learned, attempts, correct, accuracy };
}

function refreshStats() {
  const stats = getStats();
  $("#miniLearned").textContent = String(stats.learned);
  $("#miniAccuracy").textContent = stats.accuracy === null ? "—" : `${stats.accuracy}%`;
  $("#statsLearned").textContent = String(stats.learned);
  $("#statsAccuracy").textContent = stats.accuracy === null ? "—" : `${stats.accuracy}%`;
  $("#navStudyCount").textContent = String(Math.max(state.session.length - Math.min(state.sessionIndex, state.session.length), 0));
  renderHistory(stats);
}

function renderHistory(stats) {
  const bars = $("#historyBars");
  if (!bars) return;
  const values = [0, 0, 0, 0, 0, Math.min(stats.attempts, 10), state.sessionAnswered];
  bars.innerHTML = values.map((value, index) => `<div class="history-bar ${index === values.length - 1 ? "active" : ""}" style="height:${Math.max(value * 10, 8)}px" title="${value} answered"></div>`).join("");
}

function getVisibleLibraryCards() {
  const query = $("#searchInput").value.trim().toLowerCase();
  return getTabCards(getActiveTab())
    .filter((card) => `${card.german} ${card.english} ${card.forms}`.toLowerCase().includes(query))
    .sort((a, b) => state.sortAscending ? a.number - b.number : b.number - a.number);
}

function updateSelectionSummary() {
  const canCreateTab = getActiveTab()?.type === "main";
  const selectedCount = canCreateTab ? state.selectedCardIds.size : 0;
  const visibleCount = getTabCards(getActiveTab()).length;
  $("#selectedCount").textContent = String(selectedCount);
  $("#selectVisibleButton").disabled = !canCreateTab;
  $("#testSelectedButton").disabled = !canCreateTab || selectedCount === 0;
  $("#clearSelectionButton").disabled = selectedCount === 0;
  $("#selectionSummary").textContent = canCreateTab
    ? selectedCount ? `${selectedCount} selected` : "Select cards to make a focused test"
    : `${visibleCount} cards in ${getActiveTab()?.label || "this tab"}`;
}

function renderLibrary() {
  const visible = getVisibleLibraryCards();
  $("#browseResultLabel").textContent = `${visible.length} ${visible.length === 1 ? "word" : "words"}`;
  const canCreateTab = getActiveTab()?.type === "main";
  $("#libraryCountLabel").textContent = `${getTabCards(getActiveTab()).length.toLocaleString()} cards`;
  $("#navBrowseCount").textContent = getTabCards(getActiveTab()).length.toLocaleString();
  $("#cardLibrary").innerHTML = visible.map((card) => `
    <article class="library-card ${canCreateTab && state.selectedCardIds.has(card.id) ? "selected" : ""}">
      <label class="library-select" title="Select ${escapeHtml(card.german)}">
        <input class="card-select" type="checkbox" data-card-id="${escapeHtml(card.id)}" ${canCreateTab && state.selectedCardIds.has(card.id) ? "checked" : ""} ${canCreateTab ? "" : "disabled"} aria-label="Select ${escapeHtml(card.german)}" />
        <span class="library-index">${String(card.number).padStart(3, "0")}</span>
      </label>
      <div><div class="library-word">${escapeHtml(card.german)}</div><div class="library-meaning">${escapeHtml(card.english)}</div></div>
      <div class="library-rank">${card.rank ? `#${escapeHtml(card.rank)}` : "A2"}</div>
    </article>
  `).join("") || `<div class="empty-library">No cards match that search.</div>`;
  $$(".card-select").forEach((input) => input.addEventListener("change", (event) => {
    const cardId = event.target.dataset.cardId;
    if (event.target.checked) state.selectedCardIds.add(cardId);
    else state.selectedCardIds.delete(cardId);
    event.target.closest(".library-card")?.classList.toggle("selected", event.target.checked);
    updateSelectionSummary();
  }));
  updateSelectionSummary();
}

function renderPracticeTab() {
  const strip = $("#studyTabStrip");
  if (!strip) return;
  if (!state.practiceTabs.length) state.practiceTabs = [createMainTab()];
  state.practiceTabs = state.practiceTabs
    .map((tab, index) => ({
      id: String(tab.id || (index === 0 ? "main" : `test-${index}`)),
      label: String(tab.label || (index === 0 ? "Study" : `Selected test ${index}`)),
      type: index === 0 || tab.type !== "selected" ? "main" : "selected",
      cardIds: Array.isArray(tab.cardIds) ? tab.cardIds : null,
    }))
    .filter((tab, index) => index === 0 || tab.type === "selected");
  if (!state.practiceTabs.some((tab) => tab.id === state.activeTabId)) state.activeTabId = "main";
  strip.innerHTML = state.practiceTabs.map((tab) => {
    const active = tab.id === state.activeTabId;
    if (tab.type === "main") {
      return `<button class="study-tab${active ? " active" : ""}" data-open-tab="${escapeHtml(tab.id)}" type="button" role="tab" aria-selected="${active}"><span>${escapeHtml(tab.label)}</span></button>`;
    }
    return `<div class="study-tab${active ? " active" : ""}" role="tab" aria-selected="${active}">
      <button class="study-tab-main" data-open-tab="${escapeHtml(tab.id)}" type="button">
        <span>${escapeHtml(tab.label)}</span><span class="study-tab-count">${tab.cardIds.length.toLocaleString()}</span>
      </button>
      <button class="study-tab-close" data-close-tab="${escapeHtml(tab.id)}" type="button" aria-label="Close ${escapeHtml(tab.label)}">×</button>
    </div>`;
  }).join("");
  strip.querySelectorAll("[data-open-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.openTab)));
  strip.querySelectorAll("[data-close-tab]").forEach((button) => button.addEventListener("click", () => closeTab(button.dataset.closeTab)));
}

function selectVisibleCards() {
  if (getActiveTab()?.type !== "main") return;
  getVisibleLibraryCards().forEach((card) => state.selectedCardIds.add(card.id));
  renderLibrary();
}

function clearSelectedCards() {
  state.selectedCardIds.clear();
  renderLibrary();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function showView(viewName) {
  const activeNavView = viewName === "focused" ? "study" : viewName;
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === activeNavView));
  const panelName = viewName === "focused" ? "study" : viewName;
  $$(".view").forEach((view) => { view.hidden = view.dataset.panel !== panelName; });
  if (viewName === "browse") renderLibrary();
  if (viewName === "stats") refreshStats();
  if (panelName === "study") renderPracticeTab();
}

function toggleSidebar(open) {
  const sidebar = $("#sidebar");
  const menuButton = $("#mobileMenuButton");
  const backdrop = $("#sidebarBackdrop");
  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  const nextOpen = typeof open === "boolean" ? open : !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", nextOpen);
  sidebar.setAttribute("aria-hidden", isMobile ? String(!nextOpen) : "false");
  backdrop.classList.toggle("visible", nextOpen);
  backdrop.setAttribute("aria-hidden", String(!nextOpen));
  menuButton.setAttribute("aria-expanded", String(nextOpen));
  menuButton.setAttribute("aria-label", nextOpen ? "Close navigation menu" : "Open navigation menu");
  document.body.classList.toggle("menu-open", nextOpen);
  if (nextOpen) sidebar.querySelector("button")?.focus();
  else if (isMobile) menuButton.focus();
}

function speakCurrent() {
  const card = state.session[state.sessionIndex];
  if (!card || !state.soundOn || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(card.german);
  utterance.lang = "de-DE";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

async function init() {
  $("#dateLabel").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  await loadDeck(state.deckKey);

  if (window.matchMedia("(max-width: 720px)").matches) $("#sidebar").setAttribute("aria-hidden", "true");
  $("#mobileMenuButton").addEventListener("click", () => toggleSidebar());
  $("#sidebarBackdrop").addEventListener("click", () => toggleSidebar(false));
  $$(".deck-option").forEach((button) => button.addEventListener("click", () => { toggleSidebar(false); selectDeck(button.dataset.deck); }));
  $("#deckSelect").addEventListener("change", (event) => selectDeck(event.target.value));
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => {
    toggleSidebar(false);
    if (button.dataset.view === "study") activateTab("main");
    else showView(button.dataset.view);
  }));
  $("#skipButton").addEventListener("click", () => {
    if (state.sessionIndex >= state.session.length) { startSession(); return; }
    if (state.answered) advanceCard();
    else { showToast("Skipped for now"); advanceCard(); }
    refreshStats();
  });
  $("#speakButton").addEventListener("click", speakCurrent);
  $$(".review-button").forEach((button) => button.addEventListener("click", () => rateCard(button.dataset.rating)));
  $("#soundToggle").addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    $("#soundToggle").style.color = state.soundOn ? "var(--blue)" : "#b5aea4";
    showToast(state.soundOn ? "Pronunciation on" : "Pronunciation muted");
  });
  $("#searchInput").addEventListener("input", renderLibrary);
  $("#selectVisibleButton").addEventListener("click", selectVisibleCards);
  $("#clearSelectionButton").addEventListener("click", clearSelectedCards);
  $("#testSelectedButton").addEventListener("click", startSelectedTest);
  $("#sortButton").addEventListener("click", () => {
    state.sortAscending = !state.sortAscending;
    $("#sortButton").innerHTML = `Sort: ${state.sortAscending ? "original order" : "reverse order"} <span>⌄</span>`;
    renderLibrary();
  });
  $("#resetProgressButton").addEventListener("click", () => {
    if (!Object.keys(state.progress).length || window.confirm("Reset all saved progress on this device?")) {
      state.progress = {};
      saveProgress();
      startSession();
      showToast("Progress reset");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { toggleSidebar(false); return; }
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (/^[1-4]$/.test(event.key)) answer(Number(event.key) - 1);
    if (event.key.toLowerCase() === "n" && state.answered) advanceCard();
  });
}

init().catch((error) => {
  console.error(error);
  $("#germanWord").textContent = "Deck unavailable";
  $("#answerFeedback").textContent = "Could not load the vocabulary file.";
});
