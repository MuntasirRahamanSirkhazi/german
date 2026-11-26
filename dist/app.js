const SELECTED_DECK_KEY = "karten-selected-deck";
const DECKS = {
  a2: { name: "German A2", data: "./data/cards.json?v=20261126-6", count: 723 },
  b1: { name: "German B1", data: "./data/b1-cards.json?v=20261126-6", count: 2632 },
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
  bookmarkedCardIds: new Set(),
  importantBookmarkedIds: new Set(),
  selectedBookmarkIds: new Set(),
  importantCards: [],
  importantLoading: false,
  importantLoadPromise: null,
  importantFilter: "A2",
  selectedImportantIds: new Set(),
  audioTasks: [],
  audioLoading: false,
  audioLoadPromise: null,
  audioLevel: initialDeckKey === "b1" ? "B1" : "A2",
  audioTaskId: null,
  audioDictationInput: "",
  audioDictationChecked: false,
  audioDictationCorrect: false,
  audioAnswers: {},
  audioQuestionsChecked: false,
  audioTranscriptRevealed: false,
  audioProgress: {},
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

function loadBookmarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(`karten-german-${state.deckKey}-bookmarks`) || "[]"));
  } catch {
    return new Set();
  }
}

function saveBookmarks() {
  try {
    localStorage.setItem(`karten-german-${state.deckKey}-bookmarks`, JSON.stringify([...state.bookmarkedCardIds]));
  } catch {
    // Bookmarks still work for the current visit if storage is unavailable.
  }
  updateBookmarkCount();
}

function loadImportantBookmarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(`karten-german-${state.deckKey}-important-bookmarks`) || "[]"));
  } catch {
    return new Set();
  }
}

function saveImportantBookmarks() {
  try {
    localStorage.setItem(`karten-german-${state.deckKey}-important-bookmarks`, JSON.stringify([...state.importantBookmarkedIds]));
  } catch {
    // Important bookmarks still work for the current visit if storage is unavailable.
  }
  updateBookmarkCount();
}

function loadAudioProgress() {
  try {
    return JSON.parse(localStorage.getItem("karten-german-audio-progress") || "{}");
  } catch {
    return {};
  }
}

function saveAudioProgress() {
  try {
    localStorage.setItem("karten-german-audio-progress", JSON.stringify(state.audioProgress));
  } catch {
    // Audio results still work for the current visit if storage is unavailable.
  }
}

function getAudioTasksForLevel(level = state.audioLevel) {
  return state.audioTasks.filter((task) => task.level === level);
}

function getCurrentAudioTask() {
  return state.audioTasks.find((task) => task.id === state.audioTaskId) || null;
}

function resetAudioTask(taskId) {
  state.audioTaskId = taskId;
  state.audioDictationInput = "";
  state.audioDictationChecked = false;
  state.audioDictationCorrect = false;
  state.audioAnswers = {};
  state.audioQuestionsChecked = false;
  state.audioTranscriptRevealed = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function chooseAudioLevel(level) {
  if (!["A2", "B1"].includes(level)) return;
  state.audioLevel = level;
  const tasks = getAudioTasksForLevel(level);
  const unfinished = tasks.find((task) => !state.audioProgress[task.id]?.completed);
  resetAudioTask((unfinished || tasks[0])?.id || null);
  renderAudio();
}

function selectAudioTask(taskId) {
  const task = state.audioTasks.find((item) => item.id === taskId);
  if (!task) return;
  state.audioLevel = task.level;
  resetAudioTask(task.id);
  renderAudio();
}

function normalizeAudioText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finishAudioTaskIfReady() {
  const task = getCurrentAudioTask();
  if (!task || !state.audioDictationChecked || !state.audioQuestionsChecked) return;
  const correctQuestions = task.questions.reduce((total, question, index) => total + (state.audioAnswers[index] === question.answer ? 1 : 0), 0);
  state.audioProgress[task.id] = {
    completed: true,
    dictationCorrect: state.audioDictationCorrect,
    correctQuestions,
    totalQuestions: task.questions.length,
    score: Number(((Number(state.audioDictationCorrect) + correctQuestions) / (task.questions.length + 1) * 100).toFixed(0)),
    completedAt: new Date().toISOString(),
  };
  saveAudioProgress();
}

function checkAudioDictation() {
  const task = getCurrentAudioTask();
  if (!task) return;
  if (!state.audioDictationInput.trim()) {
    showToast("Write what you heard first");
    return;
  }
  state.audioDictationCorrect = normalizeAudioText(state.audioDictationInput) === normalizeAudioText(task.dictation);
  state.audioDictationChecked = true;
  renderAudio();
  finishAudioTaskIfReady();
  renderAudio();
}

function checkAudioQuestions() {
  const task = getCurrentAudioTask();
  if (!task) return;
  if (task.questions.some((_, index) => state.audioAnswers[index] === undefined)) {
    showToast("Answer every question first");
    return;
  }
  state.audioQuestionsChecked = true;
  state.audioTranscriptRevealed = true;
  renderAudio();
  finishAudioTaskIfReady();
  renderAudio();
}

function playCurrentAudio() {
  const task = getCurrentAudioTask();
  const status = $("#audioPlaybackStatus");
  if (!task) return;
  if (!("speechSynthesis" in window)) {
    if (status) status.textContent = "Audio generation is not supported in this browser.";
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(task.transcript);
  utterance.lang = "de-DE";
  utterance.rate = Number($("#audioSpeedSelect")?.value || (task.level === "B1" ? 0.82 : 0.88));
  utterance.pitch = 1;
  utterance.onstart = () => { if (status) status.textContent = "Playing… listen for the details."; };
  utterance.onend = () => { if (status) status.textContent = "Audio ended. Replay it if you need one more listen."; };
  window.speechSynthesis.speak(utterance);
  if (status) status.textContent = "Playing… listen for the details.";
}

function nextAudioTask() {
  const tasks = getAudioTasksForLevel();
  if (!tasks.length) return;
  const currentIndex = Math.max(0, tasks.findIndex((task) => task.id === state.audioTaskId));
  selectAudioTask(tasks[(currentIndex + 1) % tasks.length].id);
}

function updateBookmarkCount() {
  const count = state.bookmarkedCardIds.size + state.importantBookmarkedIds.size;
  const navCount = $("#navBookmarkCount");
  const pageCount = $("#bookmarkCountLabel");
  if (navCount) navCount.textContent = String(count);
  if (pageCount) pageCount.textContent = `${count.toLocaleString()} ${count === 1 ? "card" : "cards"}`;
}

function updateBookmarkButton(card) {
  const button = $("#bookmarkButton");
  if (!button) return;
  const bookmarked = Boolean(card && getBookmarkSetForCard(card).has(card.id));
  button.disabled = !card;
  button.classList.toggle("active", bookmarked);
  button.setAttribute("aria-pressed", String(bookmarked));
  button.innerHTML = `<span aria-hidden="true">${bookmarked ? "★" : "☆"}</span><span>${bookmarked ? "Bookmarked" : "Bookmark"}</span>`;
}

function toggleBookmark() {
  const card = state.session[state.sessionIndex];
  if (!card) return;
  const bookmarkSet = getBookmarkSetForCard(card);
  const bookmarked = bookmarkSet.has(card.id);
  if (bookmarked) bookmarkSet.delete(card.id);
  else bookmarkSet.add(card.id);
  if (isImportantCard(card)) saveImportantBookmarks();
  else saveBookmarks();
  updateBookmarkButton(card);
  if (!$("#bookmarksView")?.hidden) renderBookmarks();
  showToast(bookmarked ? "Bookmark removed" : "Card bookmarked");
}

function createMainTab() {
  return { id: "main", label: "Study", type: "main", cardIds: null };
}

function getActiveTab() {
  if (!state.practiceTabs.length) state.practiceTabs = [createMainTab()];
  return state.practiceTabs.find((tab) => tab.id === state.activeTabId) || state.practiceTabs[0];
}

function getCardNumber(card) {
  return Number(card?.number ?? card?.priority ?? 0);
}

function getImportantLevel() {
  return state.deckKey === "b1" ? "B1" : "A2";
}

function getCurrentImportantCards() {
  return state.importantCards.filter((card) => card.level === getImportantLevel());
}

function isImportantCard(card) {
  return String(card?.id || "").startsWith("important-");
}

function getBookmarkSetForCard(card) {
  return isImportantCard(card) ? state.importantBookmarkedIds : state.bookmarkedCardIds;
}

function getBookmarkPool() {
  return [...state.cards, ...getCurrentImportantCards()];
}

function getCardPoolForTab(tab) {
  if (tab?.type === "important") return getCurrentImportantCards();
  if (tab?.type === "bookmarks") return getBookmarkPool();
  return state.cards;
}

function getTabCards(tab) {
  if (!tab || tab.type === "main") return state.cards;
  const pool = getCardPoolForTab(tab);
  const cardIds = new Set(tab.cardIds || []);
  return pool.filter((card) => cardIds.has(card.id));
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
  if (!state.activeTabId) return;
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
  const cardsById = new Map(getCardPoolForTab(tab).map((card) => [card.id, card]));
  const restored = saved.sessionIds.map((id) => cardsById.get(id)).filter(Boolean);
  if (!restored.length) return false;
  const restoredIds = new Set(restored.map((card) => card.id));
  const isFocusedTab = tab.type !== "main";
  const pool = getCardPoolForTab(tab);
  state.sessionScope = isFocusedTab ? "selected" : "all";
  state.session = state.sessionScope === "selected"
    ? restored
    : [...restored, ...pool.filter((card) => !restoredIds.has(card.id))];
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
      const savedFocused = savedTabs.tabs
        .filter((tab) => tab.id !== "main" && ["selected", "important", "bookmarks"].includes(tab.type))
        .map((tab, index) => {
          const type = ["important", "bookmarks"].includes(tab.type) ? tab.type : "selected";
          const pool = getCardPoolForTab({ type });
          return {
          id: String(tab.id),
          label: String(tab.label || `${type === "important" ? "Important" : type === "bookmarks" ? "Bookmarked" : "Selected"} test ${index + 1}`),
          type,
          cardIds: pool.filter((card) => (tab.cardIds || []).includes(card.id)).map((card) => card.id),
        }; })
        .filter((tab) => tab.cardIds.length);
      state.practiceTabs = [createMainTab(), ...savedFocused];
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
  $("#deckA2Count").textContent = state.deckKey === "a2" ? state.cards.length.toLocaleString() : `${DECKS.a2.count.toLocaleString()}`;
  $("#deckB1Count").textContent = `${DECKS.b1.count.toLocaleString()}`;
  $("#libraryCountLabel").textContent = `${state.cards.length.toLocaleString()} cards`;
  $("#navBrowseCount").textContent = state.cards.length.toLocaleString();
  $("#navImportantCount").textContent = getCurrentImportantCards().length.toLocaleString();
  updateBookmarkCount();
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
  await loadImportantData().catch(() => []);
  state.deckKey = deckKey;
  state.audioLevel = getImportantLevel();
  state.cards = await response.json();
  state.selectedCardIds = new Set();
  state.selectedBookmarkIds = new Set();
  state.selectedImportantIds = new Set();
  state.importantBookmarkedIds = loadImportantBookmarks();
  state.importantFilter = getImportantLevel();
  state.practiceTabs = [];
  state.tabSessions = {};
  state.activeTabId = "main";
  state.progress = loadProgress();
  state.bookmarkedCardIds = loadBookmarks();
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
  state.sessionScope = tab.type === "main" ? "all" : "selected";
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

function startSelectedBookmarkTest() {
  if (getActiveTab()?.type !== "main") {
    showToast("Open the Study tab to create a new tab");
    return;
  }
  const selectedCards = getBookmarkPool().filter((card) => state.selectedBookmarkIds.has(card.id) && getBookmarkSetForCard(card).has(card.id));
  if (!selectedCards.length) {
    showToast("Select at least one bookmarked card first");
    return;
  }
  saveSessionState();
  const testNumber = state.practiceTabs.filter((tab) => ["selected", "important", "bookmarks"].includes(tab.type)).length + 1;
  const tab = {
    id: `bookmark-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: `Bookmarked test ${testNumber}`,
    type: "bookmarks",
    cardIds: selectedCards.map((card) => card.id),
  };
  state.practiceTabs.push(tab);
  state.activeTabId = tab.id;
  state.selectedBookmarkIds.clear();
  startSession();
  renderBookmarks();
  renderPracticeTab();
  showView("study");
  showToast(`Bookmarked test started with ${selectedCards.length} cards`);
}

function startImportantTest() {
  if (getActiveTab()?.type !== "main") {
    showToast("Open the Study tab to create a new tab");
    return;
  }
  const selectedCards = getCurrentImportantCards().filter((card) => state.selectedImportantIds.has(card.id));
  if (!selectedCards.length) {
    showToast("Select at least one important card first");
    return;
  }
  saveSessionState();
  const testNumber = state.practiceTabs.filter((tab) => ["selected", "important", "bookmarks"].includes(tab.type)).length + 1;
  const tab = {
    id: `important-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: `Important test ${testNumber}`,
    type: "important",
    cardIds: selectedCards.map((card) => card.id),
  };
  state.practiceTabs.push(tab);
  state.activeTabId = tab.id;
  state.selectedImportantIds.clear();
  startSession();
  renderImportant();
  renderPracticeTab();
  showView("study");
  showToast(`Important test started with ${selectedCards.length} cards`);
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
    state.selectedImportantIds.clear();
    if (!restoreTabSession(getActiveTab(), state.tabSessions.main)) startSession();
  }
  saveSessionState();
  renderPracticeTab();
  renderLibrary();
  showView("study");
  showToast("Selected test tab closed");
}

function buildOptions(card) {
  const optionPool = getCardPoolForTab(getActiveTab());
  const otherMeanings = shuffle(optionPool.filter((item) => item.id !== card.id)).slice(0, 3).map((item) => item.english);
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
  $("#cardNumber").textContent = `CARD ${String(getCardNumber(card)).padStart(3, "0")}`;
  $("#germanWord").textContent = card.german;
  updateBookmarkButton(card);
  $("#wordForms").textContent = card.forms || "A2 vocabulary in context";
  $("#germanSentence").textContent = card.sentenceDe || "Practice this word in a sentence.";
  $("#answerFeedback").textContent = "";
  $("#answerFeedback").className = "answer-feedback";
  $("#previousButton").disabled = state.sessionIndex <= 0;
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

function previousCard() {
  if (state.sessionIndex <= 0) return;
  state.sessionIndex -= 1;
  renderCard();
  saveSessionState();
  refreshStats();
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
  updateBookmarkButton(null);
  $("#answerFeedback").textContent = `${state.sessionAnswered} cards answered. Your progress is saved on this device.`;
  $("#answerFeedback").className = "answer-feedback success";
  setReviewControls(false);
  const isSelectedTab = state.sessionScope === "selected";
  $("#reviewHint").textContent = isSelectedTab ? "Repeat this selected test" : "Start another full deck review";
  $("#options").innerHTML = `<button class="option-button correct" id="newSessionButton" type="button"><span class="option-number">↻</span><span>${isSelectedTab ? "Repeat selected test" : "Start a new session"}</span></button>`;
  $("#newSessionButton").addEventListener("click", startSession);
  $("#previousButton").disabled = true;
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
  const maxValue = Math.max(...values, 1);
  const chartHeight = 120;
  bars.innerHTML = values.map((value, index) => {
    const height = value ? Math.max(8, Math.round((value / maxValue) * chartHeight)) : 8;
    return `<div class="history-bar ${index === values.length - 1 ? "active" : ""}" style="height:${height}px" title="${value} answered"></div>`;
  }).join("");
}

function getVisibleLibraryCards() {
  const query = $("#searchInput").value.trim().toLowerCase();
  return getTabCards(getActiveTab())
    .filter((card) => `${card.german} ${card.english} ${card.forms}`.toLowerCase().includes(query))
    .sort((a, b) => state.sortAscending ? getCardNumber(a) - getCardNumber(b) : getCardNumber(b) - getCardNumber(a));
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
  const activeTab = getActiveTab();
  const canCreateTab = activeTab?.type === "main";
  const canRemoveFromTab = activeTab?.type === "selected";
  $("#libraryCountLabel").textContent = `${getTabCards(getActiveTab()).length.toLocaleString()} cards`;
  $("#navBrowseCount").textContent = getTabCards(getActiveTab()).length.toLocaleString();
  $("#cardLibrary").innerHTML = visible.map((card) => `
    <article class="library-card ${canCreateTab && state.selectedCardIds.has(card.id) ? "selected" : ""}">
      <label class="library-select" title="Select ${escapeHtml(card.german)}">
        <input class="card-select" type="checkbox" data-card-id="${escapeHtml(card.id)}" ${canCreateTab && state.selectedCardIds.has(card.id) ? "checked" : ""} ${canCreateTab ? "" : "disabled"} aria-label="Select ${escapeHtml(card.german)}" />
        <span class="library-index">${String(getCardNumber(card)).padStart(3, "0")}</span>
      </label>
      <div><div class="library-word">${escapeHtml(card.german)}</div><div class="library-meaning">${escapeHtml(card.english)}</div></div>
      <div class="library-card-meta">
        <div class="library-rank">${card.rank ? `#${escapeHtml(card.rank)}` : "A2"}</div>
        ${canRemoveFromTab ? `<button class="remove-card-button" data-remove-card="${escapeHtml(card.id)}" type="button" aria-label="Remove ${escapeHtml(card.german)} from this test">Remove</button>` : ""}
      </div>
    </article>
  `).join("") || `<div class="empty-library">No cards match that search.</div>`;
  $("#cardLibrary").querySelectorAll(".card-select").forEach((input) => input.addEventListener("change", (event) => {
    const cardId = event.target.dataset.cardId;
    if (event.target.checked) state.selectedCardIds.add(cardId);
    else state.selectedCardIds.delete(cardId);
    event.target.closest(".library-card")?.classList.toggle("selected", event.target.checked);
    updateSelectionSummary();
  }));
  $$(".remove-card-button").forEach((button) => button.addEventListener("click", () => removeCardFromSelectedTab(button.dataset.removeCard)));
  updateSelectionSummary();
}

function getBookmarkedCardsForCurrentDeck() {
  return getBookmarkPool().filter((card) => getBookmarkSetForCard(card).has(card.id));
}

function getVisibleBookmarkCards() {
  const query = $("#bookmarkSearchInput")?.value.trim().toLowerCase() || "";
  return getBookmarkedCardsForCurrentDeck()
    .filter((card) => `${card.german} ${card.english} ${card.forms} ${card.sentenceDe}`.toLowerCase().includes(query))
    .sort((a, b) => state.sortAscending ? getCardNumber(a) - getCardNumber(b) : getCardNumber(b) - getCardNumber(a));
}

function renderBookmarks() {
  const visible = getVisibleBookmarkCards();
  $("#bookmarkResultLabel").textContent = `${visible.length} ${visible.length === 1 ? "word" : "words"}`;
  $("#bookmarkLibrary").innerHTML = visible.map((card) => `
    <article class="library-card bookmark-library-card ${state.selectedBookmarkIds.has(card.id) ? "selected" : ""}">
      <label class="library-select" title="Select ${escapeHtml(card.german)}">
        <input class="card-select bookmark-select" type="checkbox" data-bookmark-id="${escapeHtml(card.id)}" ${state.selectedBookmarkIds.has(card.id) ? "checked" : ""} aria-label="Select ${escapeHtml(card.german)} bookmark" />
        <span class="library-index">${String(getCardNumber(card)).padStart(3, "0")}</span>
      </label>
      <div><div class="library-word">${escapeHtml(card.german)}</div><div class="library-meaning">${escapeHtml(card.english)}</div></div>
      <div class="library-card-meta">
        <div class="library-rank">${isImportantCard(card) ? `${escapeHtml(card.level)} · ${escapeHtml(card.partOfSpeech || "Core")}` : (card.rank ? `#${escapeHtml(card.rank)}` : getImportantLevel())}</div>
        <button class="remove-bookmark-button" data-bookmark-id="${escapeHtml(card.id)}" data-bookmark-source="${isImportantCard(card) ? "important" : "deck"}" type="button" aria-label="Remove ${escapeHtml(card.german)} bookmark">Remove</button>
      </div>
    </article>
  `).join("") || `<div class="empty-library">No bookmarked cards yet. Use Bookmark while practicing.</div>`;
  $("#bookmarkLibrary").querySelectorAll(".bookmark-select").forEach((input) => input.addEventListener("change", (event) => {
    const cardId = event.target.dataset.bookmarkId;
    if (event.target.checked) state.selectedBookmarkIds.add(cardId);
    else state.selectedBookmarkIds.delete(cardId);
    event.target.closest(".library-card")?.classList.toggle("selected", event.target.checked);
    updateBookmarkSelectionSummary();
  }));
  $$(".remove-bookmark-button").forEach((button) => button.addEventListener("click", () => {
    const bookmarkSet = button.dataset.bookmarkSource === "important" ? state.importantBookmarkedIds : state.bookmarkedCardIds;
    bookmarkSet.delete(button.dataset.bookmarkId);
    state.selectedBookmarkIds.delete(button.dataset.bookmarkId);
    if (button.dataset.bookmarkSource === "important") saveImportantBookmarks();
    else saveBookmarks();
    renderBookmarks();
    updateBookmarkButton(state.session[state.sessionIndex]);
    showToast("Bookmark removed");
  }));
  updateBookmarkCount();
  updateBookmarkSelectionSummary();
}

function updateBookmarkSelectionSummary() {
  const selectedCount = [...state.selectedBookmarkIds].filter((id) => getBookmarkedCardsForCurrentDeck().some((card) => card.id === id)).length;
  const canCreateTab = getActiveTab()?.type === "main";
  const summary = $("#bookmarkSelectionSummary");
  const selectedLabel = $("#bookmarkSelectedCount");
  const selectVisibleButton = $("#selectVisibleBookmarksButton");
  const clearButton = $("#clearBookmarkSelectionButton");
  const testButton = $("#testBookmarkedButton");
  if (selectedLabel) selectedLabel.textContent = String(selectedCount);
  if (selectVisibleButton) selectVisibleButton.disabled = !canCreateTab || !getBookmarkedCardsForCurrentDeck().length;
  if (clearButton) clearButton.disabled = selectedCount === 0;
  if (testButton) testButton.disabled = !canCreateTab || selectedCount === 0;
  if (summary) {
    summary.textContent = !canCreateTab
      ? "Open the Study tab to create a new test"
      : selectedCount ? `${selectedCount} selected` : "Select cards to make a focused test";
  }
}

function selectVisibleBookmarks() {
  if (getActiveTab()?.type !== "main") {
    showToast("Open the Study tab to create a new tab");
    return;
  }
  getVisibleBookmarkCards().forEach((card) => state.selectedBookmarkIds.add(card.id));
  renderBookmarks();
}

function clearSelectedBookmarks() {
  state.selectedBookmarkIds.clear();
  renderBookmarks();
}

function renderPracticeTab() {
  const strip = $("#studyTabStrip");
  if (!strip) return;
  if (!state.practiceTabs.length) state.practiceTabs = [createMainTab()];
  state.practiceTabs = state.practiceTabs
    .map((tab, index) => ({
      id: String(tab.id || (index === 0 ? "main" : `test-${index}`)),
      label: String(tab.label || (index === 0 ? "Study" : `${tab.type === "important" ? "Important" : tab.type === "bookmarks" ? "Bookmarked" : "Selected"} test ${index}`)),
      type: index === 0 ? "main" : ["important", "bookmarks"].includes(tab.type) ? tab.type : "selected",
      cardIds: Array.isArray(tab.cardIds) ? tab.cardIds : null,
    }))
    .filter((tab, index) => index === 0 || ["selected", "important", "bookmarks"].includes(tab.type));
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

function removeCardFromSelectedTab(cardId) {
  const tab = getActiveTab();
  if (!tab || tab.type !== "selected") return;
  const card = state.cards.find((item) => item.id === cardId);
  if (!card) return;

  tab.cardIds = (tab.cardIds || []).filter((id) => id !== cardId);
  state.selectedCardIds.delete(cardId);
  const removedBeforeCurrent = state.session
    .slice(0, state.sessionIndex)
    .filter((item) => item.id === cardId).length;
  const removedCurrent = state.session[state.sessionIndex]?.id === cardId;
  state.session = state.session.filter((item) => item.id !== cardId);
  state.sessionIndex = Math.max(0, state.sessionIndex - removedBeforeCurrent);
  state.sessionIndex = Math.min(state.sessionIndex, state.session.length);
  state.repeatScheduled.delete(cardId);
  state.sessionAnswered = Math.min(state.sessionAnswered, state.session.length);
  if (removedCurrent) renderCard();
  saveSessionState();
  renderLibrary();
  renderPracticeTab();
  showToast(`Removed ${card.german} from this test`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function loadImportantData() {
  if (state.importantCards.length) return Promise.resolve(state.importantCards);
  if (state.importantLoadPromise) return state.importantLoadPromise;
  state.importantLoading = true;
  state.importantLoadPromise = fetch("./data/important-vocabulary.json?v=20261126-6")
    .then((response) => {
      if (!response.ok) throw new Error("Could not load important vocabulary");
      return response.json();
    })
    .then((cards) => {
      state.importantCards = cards;
      return cards;
    })
    .finally(() => { state.importantLoading = false; });
  return state.importantLoadPromise;
}

function loadAudioData() {
  if (state.audioTasks.length) return Promise.resolve(state.audioTasks);
  if (state.audioLoadPromise) return state.audioLoadPromise;
  state.audioLoading = true;
  state.audioLoadPromise = fetch("./data/audio-tasks.json?v=20261126-1")
    .then((response) => {
      if (!response.ok) throw new Error("Could not load audio practice");
      return response.json();
    })
    .then((tasks) => {
      state.audioTasks = tasks;
      return tasks;
    })
    .finally(() => { state.audioLoading = false; });
  return state.audioLoadPromise;
}

function renderAudio() {
  const taskList = $("#audioTaskList");
  if (!taskList) return;
  if (!state.audioProgress || typeof state.audioProgress !== "object") state.audioProgress = {};
  if (!state.audioTasks.length && !state.audioLoading) {
    taskList.innerHTML = `<div class="empty-library">Loading listening tasks…</div>`;
    loadAudioData()
      .then(() => {
        const tasks = getAudioTasksForLevel();
        if (!state.audioTaskId || !state.audioTasks.some((task) => task.id === state.audioTaskId)) {
          const next = tasks.find((task) => !state.audioProgress[task.id]?.completed) || tasks[0];
          resetAudioTask(next?.id || null);
        }
        renderAudio();
      })
      .catch(() => { taskList.innerHTML = `<div class="empty-library">Audio practice could not be loaded. Please reload the page.</div>`; });
    return;
  }
  if (!state.audioTasks.length) return;

  const tasks = getAudioTasksForLevel();
  const currentTask = getCurrentAudioTask();
  const task = tasks.some((item) => item.id === currentTask?.id) ? currentTask : tasks[0];
  if (!task) return;
  if (state.audioTaskId !== task.id) resetAudioTask(task.id);
  const completed = tasks.filter((item) => state.audioProgress[item.id]?.completed).length;
  const levelCount = tasks.length;
  $("#navAudioCount").textContent = String(levelCount);
  $("#audioLevelContext").textContent = `German ${state.audioLevel} · ${levelCount} tracks`;
  $("#audioTaskCountLabel").textContent = `${levelCount} ${state.audioLevel} recordings`;
  $("#audioResultLabel").textContent = `${completed}/${levelCount} completed`;
  $("#audioLevelLabel").textContent = `${state.audioLevel} listening practice`;
  const taskIndex = tasks.findIndex((item) => item.id === task.id) + 1;
  $("#audioTaskNumber").textContent = `AUDIO ${String(taskIndex).padStart(2, "0")}`;
  $("#audioTaskTitle").textContent = `Track ${taskIndex}`;
  $("#audioTaskTopic").textContent = `${state.audioLevel} listening task`;
  $("#audioDifficulty").textContent = task.level === "B1" ? "Goethe-style B1 · demanding" : "Goethe-style A2 · demanding";
  $("#audioTaskList").innerHTML = tasks.map((item, index) => {
    const result = state.audioProgress[item.id];
    return `<button class="audio-task-button${item.id === task.id ? " active" : ""}" type="button" data-audio-task-id="${escapeHtml(item.id)}">
      <span class="audio-task-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="audio-task-copy"><strong>Track ${index + 1}</strong><small>${item.level} listening</small></span>
      <span class="audio-task-status">${result?.completed ? `${result.score}%` : ""}</span>
    </button>`;
  }).join("");
  taskList.querySelectorAll("[data-audio-task-id]").forEach((button) => button.addEventListener("click", () => selectAudioTask(button.dataset.audioTaskId)));

  $("#audioPlaybackStatus").textContent = "Press play, listen twice at most, then write what you heard.";
  $("#audioPlayButton").disabled = !("speechSynthesis" in window);
  $("#audioSpeedSelect").value = task.level === "B1" ? "0.82" : "0.88";
  const dictationInput = $("#audioDictationInput");
  if (document.activeElement !== dictationInput) dictationInput.value = state.audioDictationInput;
  $("#audioDictationFeedback").innerHTML = state.audioDictationChecked
    ? `<div class="audio-feedback ${state.audioDictationCorrect ? "correct" : "wrong"}">${state.audioDictationCorrect ? "Correct dictation." : `Not quite. The sentence was: <strong>${escapeHtml(task.dictation)}</strong>`}</div>`
    : "";
  $("#checkAudioDictationButton").disabled = state.audioDictationChecked;

  $("#audioQuestions").innerHTML = task.questions.map((question, questionIndex) => {
    const selected = state.audioAnswers[questionIndex];
    const answerLabel = state.audioQuestionsChecked
      ? `<div class="audio-question-result ${selected === question.answer ? "correct" : "wrong"}">${selected === question.answer ? "Correct." : `Correct answer: ${escapeHtml(question.options[question.answer])}`} <small>${escapeHtml(question.explanation)}</small></div>`
      : "";
    return `<fieldset class="audio-question">
      <legend><span>${questionIndex + 1}</span>${escapeHtml(question.prompt)}</legend>
      <div class="audio-options">${question.options.map((option, optionIndex) => {
        const isSelected = selected === optionIndex;
        const isCorrect = state.audioQuestionsChecked && optionIndex === question.answer;
        const isWrong = state.audioQuestionsChecked && isSelected && !isCorrect;
        return `<button class="audio-option${isSelected ? " selected" : ""}${isCorrect ? " correct" : ""}${isWrong ? " wrong" : ""}" type="button" data-audio-question="${questionIndex}" data-audio-option="${optionIndex}" aria-pressed="${isSelected}" ${state.audioQuestionsChecked ? "disabled" : ""}><span>${String.fromCharCode(65 + optionIndex)}</span>${escapeHtml(option)}</button>`;
      }).join("")}</div>${answerLabel}
    </fieldset>`;
  }).join("");
  $("#audioQuestions").querySelectorAll("[data-audio-question]").forEach((button) => button.addEventListener("click", () => {
    state.audioAnswers[Number(button.dataset.audioQuestion)] = Number(button.dataset.audioOption);
    renderAudio();
  }));
  $("#checkAudioQuestionsButton").disabled = state.audioQuestionsChecked;
  $("#checkAudioQuestionsButton").textContent = state.audioQuestionsChecked ? "Answers checked" : "Check answers";
  $("#audioTranscript").hidden = !state.audioTranscriptRevealed;
  $("#audioTranscriptText").textContent = task.transcript;
  $("#audioNextButton").disabled = !(state.audioDictationChecked && state.audioQuestionsChecked);
  $("#audioNextButton").textContent = state.audioProgress[task.id]?.completed ? "Next audio" : "Finish and next";
  $("#audioCompletedLabel").textContent = `${completed} of ${levelCount} completed`;
}

function renderImportant() {
  const library = $("#importantLibrary");
  if (!library) return;
  if (!state.importantCards.length && !state.importantLoading) {
    library.innerHTML = `<div class="empty-library">Loading important vocabulary…</div>`;
    loadImportantData()
      .then(() => renderImportant())
      .catch(() => {
        library.innerHTML = `<div class="empty-library">Important vocabulary could not be loaded. Please reload the page.</div>`;
      });
    return;
  }
  if (!state.importantCards.length) return;

  const level = getImportantLevel();
  state.importantFilter = level;
  const levelCards = getCurrentImportantCards();
  const query = $("#importantSearchInput")?.value.trim().toLowerCase() || "";
  const visible = levelCards.filter((card) => {
    const matchesLevel = card.level === level;
    const matchesQuery = `${card.german} ${card.english} ${card.forms} ${card.sentenceDe}`.toLowerCase().includes(query);
    return matchesLevel && matchesQuery;
  });
  const allCount = levelCards.length;
  const a2Count = state.importantCards.filter((card) => card.level === "A2").length;
  const b1Count = state.importantCards.filter((card) => card.level === "B1").length;
  $("#importantResultLabel").textContent = `${visible.length} ${visible.length === 1 ? "word" : "words"}`;
  $("#importantCountLabel").textContent = `${allCount} ${level} core cards`;
  if ($("#importantAllCount")) $("#importantAllCount").textContent = String(allCount);
  if ($("#importantA2Count")) $("#importantA2Count").textContent = String(a2Count);
  if ($("#importantB1Count")) $("#importantB1Count").textContent = String(b1Count);
  $("#navImportantCount").textContent = String(allCount);
  $$(".important-filter").forEach((button) => {
    const active = button.dataset.importantFilter === level;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  library.innerHTML = visible.map((card) => `
    <article class="library-card important-card ${state.selectedImportantIds.has(card.id) ? "selected" : ""}">
      <label class="important-card-select" title="Select ${escapeHtml(card.german)}">
        <input class="card-select important-select" type="checkbox" data-important-id="${escapeHtml(card.id)}" ${state.selectedImportantIds.has(card.id) ? "checked" : ""} aria-label="Select ${escapeHtml(card.german)}" />
        <span class="important-card-level"><strong>${escapeHtml(card.level)}</strong><span>TOP ${String(card.priority).padStart(2, "0")}</span></span>
      </label>
      <div class="important-card-content">
        <div class="library-word">${escapeHtml(card.german)}</div>
        <div class="library-meaning">${escapeHtml(card.english)}</div>
        <div class="important-example"><span>${escapeHtml(card.sentenceDe || "Practice this word in context.")}</span>${card.sentenceEn ? `<small>${escapeHtml(card.sentenceEn)}</small>` : ""}</div>
        <button class="important-bookmark-button${state.importantBookmarkedIds.has(card.id) ? " active" : ""}" data-important-bookmark-id="${escapeHtml(card.id)}" type="button" aria-label="${state.importantBookmarkedIds.has(card.id) ? "Remove bookmark from" : "Bookmark"} ${escapeHtml(card.german)}" aria-pressed="${state.importantBookmarkedIds.has(card.id)}">${state.importantBookmarkedIds.has(card.id) ? "&#9733;" : "&#9734;"} <span>${state.importantBookmarkedIds.has(card.id) ? "Bookmarked" : "Bookmark"}</span></button>
      </div>
      <div class="library-card-meta"><div class="library-rank">${escapeHtml((card.forms || "").split(" · ")[0] || "Core")}</div></div>
    </article>
  `).join("") || `<div class="empty-library">No important words match that search.</div>`;
  library.querySelectorAll(".important-select").forEach((input) => input.addEventListener("change", (event) => {
    const cardId = event.target.dataset.importantId;
    if (event.target.checked) state.selectedImportantIds.add(cardId);
    else state.selectedImportantIds.delete(cardId);
    event.target.closest(".library-card")?.classList.toggle("selected", event.target.checked);
    updateImportantSelectionSummary();
  }));
  library.querySelectorAll(".important-bookmark-button").forEach((button) => button.addEventListener("click", () => {
    const cardId = button.dataset.importantBookmarkId;
    const bookmarked = state.importantBookmarkedIds.has(cardId);
    if (bookmarked) state.importantBookmarkedIds.delete(cardId);
    else state.importantBookmarkedIds.add(cardId);
    saveImportantBookmarks();
    renderImportant();
    if (!$("#bookmarksView")?.hidden) renderBookmarks();
    showToast(bookmarked ? "Bookmark removed" : "Important word bookmarked");
  }));
  updateImportantSelectionSummary();
}

function updateImportantSelectionSummary() {
  const selectedCount = [...state.selectedImportantIds].filter((id) => getCurrentImportantCards().some((card) => card.id === id)).length;
  const canCreateTab = getActiveTab()?.type === "main";
  const summary = $("#importantSelectionSummary");
  const selectedLabel = $("#importantSelectedCount");
  const selectVisibleButton = $("#selectVisibleImportantButton");
  const clearButton = $("#clearImportantSelectionButton");
  const testButton = $("#testImportantButton");
  if (selectedLabel) selectedLabel.textContent = String(selectedCount);
  if (selectVisibleButton) selectVisibleButton.disabled = !canCreateTab || !getCurrentImportantCards().length;
  if (clearButton) clearButton.disabled = selectedCount === 0;
  if (testButton) testButton.disabled = !canCreateTab || selectedCount === 0;
  if (summary) {
    summary.textContent = !canCreateTab
      ? "Open the Study tab to create a new test"
      : selectedCount ? `${selectedCount} selected` : "Select important cards to practice";
  }
}

function selectVisibleImportant() {
  if (getActiveTab()?.type !== "main") {
    showToast("Open the Study tab to create a new tab");
    return;
  }
  const query = $("#importantSearchInput")?.value.trim().toLowerCase() || "";
  getCurrentImportantCards()
    .filter((card) => `${card.german} ${card.english} ${card.forms} ${card.sentenceDe}`.toLowerCase().includes(query))
    .forEach((card) => state.selectedImportantIds.add(card.id));
  renderImportant();
}

function clearSelectedImportant() {
  state.selectedImportantIds.clear();
  renderImportant();
}

function showView(viewName) {
  const activeNavView = viewName === "focused" ? "study" : viewName;
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === activeNavView));
  const panelName = viewName === "focused" ? "study" : viewName;
  $$(".view").forEach((view) => { view.hidden = view.dataset.panel !== panelName; });
  if (viewName === "browse") renderLibrary();
  if (viewName === "bookmarks") renderBookmarks();
  if (viewName === "important") renderImportant();
  if (viewName === "audio") renderAudio();
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

function bindBrowseControls() {
  $("#searchInput")?.addEventListener("input", renderLibrary);
  $("#bookmarkSearchInput")?.addEventListener("input", renderBookmarks);
  $("#selectVisibleButton")?.addEventListener("click", selectVisibleCards);
  $("#clearSelectionButton")?.addEventListener("click", clearSelectedCards);
  $("#testSelectedButton")?.addEventListener("click", startSelectedTest);
  $("#selectVisibleBookmarksButton")?.addEventListener("click", selectVisibleBookmarks);
  $("#clearBookmarkSelectionButton")?.addEventListener("click", clearSelectedBookmarks);
  $("#testBookmarkedButton")?.addEventListener("click", startSelectedBookmarkTest);
  $("#importantSearchInput")?.addEventListener("input", renderImportant);
  $("#selectVisibleImportantButton")?.addEventListener("click", selectVisibleImportant);
  $("#clearImportantSelectionButton")?.addEventListener("click", clearSelectedImportant);
  $("#testImportantButton")?.addEventListener("click", startImportantTest);
  $("#audioPlayButton")?.addEventListener("click", playCurrentAudio);
  $("#audioReplayButton")?.addEventListener("click", playCurrentAudio);
  $("#audioNewTaskButton")?.addEventListener("click", nextAudioTask);
  $("#checkAudioDictationButton")?.addEventListener("click", checkAudioDictation);
  $("#checkAudioQuestionsButton")?.addEventListener("click", checkAudioQuestions);
  $("#audioRevealButton")?.addEventListener("click", () => { state.audioTranscriptRevealed = !state.audioTranscriptRevealed; renderAudio(); });
  $("#audioNextButton")?.addEventListener("click", nextAudioTask);
  $("#audioDictationInput")?.addEventListener("input", (event) => { state.audioDictationInput = event.target.value; });
  $$(".important-filter").forEach((button) => button.addEventListener("click", async () => {
    const deckKey = button.dataset.importantFilter.toLowerCase();
    if (deckKey === state.deckKey) {
      renderImportant();
      return;
    }
    await selectDeck(deckKey);
    showView("important");
  }));
  $("#sortButton")?.addEventListener("click", () => {
    state.sortAscending = !state.sortAscending;
    $("#sortButton").innerHTML = `Sort: ${state.sortAscending ? "original order" : "reverse order"} <span>⌄</span>`;
    renderLibrary();
  });
}

async function init() {
  // Bind Browse first so a deck-loading or restore error cannot leave visible controls inert.
  bindBrowseControls();
  $("#dateLabel").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  state.audioProgress = loadAudioProgress();
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
  $("#previousButton").addEventListener("click", previousCard);
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
  $("#bookmarkButton").addEventListener("click", toggleBookmark);
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
  await loadDeck(state.deckKey);
}

init().catch((error) => {
  console.error(error);
  $("#germanWord").textContent = "Deck unavailable";
  $("#answerFeedback").textContent = "Could not load the vocabulary file.";
});
