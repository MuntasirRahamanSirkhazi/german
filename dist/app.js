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
  focusedTest: null,
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

function saveSessionState() {
  if (!state.session.length) return;
  try {
    localStorage.setItem(`karten-german-${state.deckKey}-session`, JSON.stringify({
      sessionIds: state.session.map((card) => card.id),
      sessionScope: state.sessionScope,
      sessionIndex: state.sessionIndex,
      sessionAnswered: state.sessionAnswered,
      repeatScheduled: [...state.repeatScheduled],
      focusedTestCardIds: state.focusedTest?.cardIds || [],
    }));
  } catch {
    // The app can still be used if browser storage is unavailable.
  }
}

function restoreSessionState() {
  try {
    const saved = JSON.parse(localStorage.getItem(`karten-german-${state.deckKey}-session`) || "null");
    if (!saved?.sessionIds?.length) return false;
    const cardsById = new Map(state.cards.map((card) => [card.id, card]));
    const restored = saved.sessionIds.map((id) => cardsById.get(id)).filter(Boolean);
    if (!restored.length) return false;
    state.sessionScope = saved.sessionScope === "selected" ? "selected" : "all";
    const restoredIds = new Set(restored.map((card) => card.id));
    const savedFocusedIds = Array.isArray(saved.focusedTestCardIds)
      ? saved.focusedTestCardIds
      : state.sessionScope === "selected" ? [...restoredIds] : [];
    const focusedIds = state.cards.filter((card) => savedFocusedIds.includes(card.id)).map((card) => card.id);
    state.focusedTest = focusedIds.length ? { cardIds: focusedIds } : null;
    state.session = state.sessionScope === "selected"
      ? restored
      : [...restored, ...state.cards.filter((card) => !restoredIds.has(card.id))];
    state.selectedCardIds.clear();
    state.sessionIndex = Math.min(Math.max(Number(saved.sessionIndex) || 0, 0), state.session.length);
    state.sessionAnswered = Math.max(Number(saved.sessionAnswered) || 0, 0);
    state.repeatScheduled = new Set(saved.repeatScheduled || []);
    state.answered = false;
    renderCard();
    renderPracticeTab();
    return true;
  } catch {
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
  state.focusedTest = null;
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
  state.session = shuffle(state.cards);
  state.sessionScope = "all";
  state.sessionIndex = 0;
  state.sessionAnswered = 0;
  state.answered = false;
  state.repeatScheduled = new Set();
  renderCard();
  saveSessionState();
  renderPracticeTab();
}

function startSelectedTest() {
  const selectedCards = state.cards.filter((card) => state.selectedCardIds.has(card.id));
  if (!selectedCards.length) {
    showToast("Select at least one card first");
    return;
  }
  state.session = shuffle(selectedCards);
  state.sessionScope = "selected";
  state.focusedTest = { cardIds: selectedCards.map((card) => card.id) };
  state.sessionIndex = 0;
  state.sessionAnswered = 0;
  state.answered = false;
  state.repeatScheduled = new Set();
  state.selectedCardIds.clear();
  renderCard();
  saveSessionState();
  renderLibrary();
  renderPracticeTab();
  showView("focused");
  showToast(`Test started with ${selectedCards.length} cards`);
}

function openFocusedTest() {
  const focusedIds = new Set(state.focusedTest?.cardIds || []);
  const focusedCards = state.cards.filter((card) => focusedIds.has(card.id));
  if (!focusedCards.length) {
    showToast("Select cards in Browse first");
    showView("browse");
    return;
  }

  const currentIds = new Set(state.session.map((card) => card.id));
  const sameSession = state.sessionScope === "selected"
    && state.sessionIndex < state.session.length
    && currentIds.size === focusedIds.size
    && [...focusedIds].every((id) => currentIds.has(id));
  if (!sameSession) {
    state.session = shuffle(focusedCards);
    state.sessionScope = "selected";
    state.sessionIndex = 0;
    state.sessionAnswered = 0;
    state.answered = false;
    state.repeatScheduled = new Set();
    renderCard();
    saveSessionState();
  }
  renderPracticeTab();
  showView("focused");
}

function closeFocusedTest() {
  if (!state.focusedTest?.cardIds?.length) return;
  state.focusedTest = null;
  state.selectedCardIds.clear();
  if (state.sessionScope === "selected") {
    state.session = shuffle(state.cards);
    state.sessionScope = "all";
    state.sessionIndex = 0;
    state.sessionAnswered = 0;
    state.answered = false;
    state.repeatScheduled = new Set();
    renderCard();
    saveSessionState();
  }
  renderPracticeTab();
  showView("study");
  showToast("Selected test tab closed");
}

function openStudyTab() {
  if (state.sessionScope !== "all") startSession();
  showView("study");
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
  const isFocused = state.sessionScope === "selected" && state.focusedTest?.cardIds?.length;
  $("#reviewHint").textContent = isFocused ? "Repeat this focused test" : "Start another full deck review";
  $("#options").innerHTML = `<button class="option-button correct" id="newSessionButton" type="button"><span class="option-number">↻</span><span>${isFocused ? "Repeat selected test" : "Start a new session"}</span></button>`;
  $("#newSessionButton").addEventListener("click", isFocused ? openFocusedTest : startSession);
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
  return state.cards
    .filter((card) => `${card.german} ${card.english} ${card.forms}`.toLowerCase().includes(query))
    .sort((a, b) => state.sortAscending ? a.number - b.number : b.number - a.number);
}

function updateSelectionSummary() {
  const selectedCount = state.selectedCardIds.size;
  $("#selectedCount").textContent = String(selectedCount);
  $("#testSelectedButton").disabled = selectedCount === 0;
  $("#clearSelectionButton").disabled = selectedCount === 0;
  $("#selectionSummary").textContent = selectedCount ? `${selectedCount} selected` : "Select cards to make a focused test";
}

function renderLibrary() {
  const visible = getVisibleLibraryCards();
  $("#browseResultLabel").textContent = `${visible.length} ${visible.length === 1 ? "word" : "words"}`;
  $("#cardLibrary").innerHTML = visible.map((card) => `
    <article class="library-card ${state.selectedCardIds.has(card.id) ? "selected" : ""}">
      <label class="library-select" title="Select ${escapeHtml(card.german)}">
        <input class="card-select" type="checkbox" data-card-id="${escapeHtml(card.id)}" ${state.selectedCardIds.has(card.id) ? "checked" : ""} aria-label="Select ${escapeHtml(card.german)}" />
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
  const count = state.focusedTest?.cardIds?.length || 0;
  const focusedTab = $("#focusedTestTab");
  const studyTab = $("#studyTab");
  if (!focusedTab || !studyTab) return;
  focusedTab.hidden = count === 0;
  focusedTab.classList.toggle("active", state.sessionScope === "selected");
  focusedTab.setAttribute("aria-selected", String(state.sessionScope === "selected"));
  studyTab.classList.toggle("active", state.sessionScope !== "selected");
  studyTab.setAttribute("aria-selected", String(state.sessionScope !== "selected"));
  $("#focusedTestCount").textContent = count.toLocaleString();
}

function selectVisibleCards() {
  getVisibleLibraryCards().forEach((card) => state.selectedCardIds.add(card.id));
  renderLibrary();
}

function clearSelectedCards() {
  state.selectedCardIds.clear();
  renderLibrary();
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
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
    if (button.dataset.view === "study") openStudyTab();
    else showView(button.dataset.view);
  }));
  $("#studyTab").addEventListener("click", openStudyTab);
  $("#openFocusedTestButton").addEventListener("click", openFocusedTest);
  $("#closeFocusedTestButton").addEventListener("click", closeFocusedTest);
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
