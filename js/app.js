import { VERBS } from "./config.js";
import { UIController } from "./ui.js";
import { TrainingEngine } from "./training.js";

const DEFAULT_VIEW = "training";
const DEFAULT_THEME = "system";
const THEME_STORAGE_KEY = "losVerbos-theme";
const DISABLED_TENSES_KEY = "losVerbos-disabledTenses";
const DEFAULT_TRANSLATION_LANGUAGE = "ru";
const TRANSLATION_LANGUAGE_KEY = "losVerbos-translationLanguage";

const state = {
  data: null,
  currentVerbId: null,
  cache: new Map(),
  pending: new Map(),
  ui: null,
  trainingEngine: null,
  training: {
    active: false,
    currentCard: null,
    answered: false
  },
  view: DEFAULT_VIEW,
  theme: DEFAULT_THEME,
  translationLanguage: DEFAULT_TRANSLATION_LANGUAGE,
  disabledTenses: new Set(),
  tenseOptions: new Map()
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  state.ui = new UIController();
  state.trainingEngine = new TrainingEngine();

  state.disabledTenses = loadDisabledTenses();
  state.tenseOptions = new Map();
  state.trainingEngine.setExcludedTenses(state.disabledTenses);

  state.theme = loadThemePreference();
  applyTheme(state.theme);
  state.ui.setThemeSelection(state.theme);

  state.ui.bindThemeChange(onThemeChange);
  state.ui.bindResetStats(onResetStats);
  state.translationLanguage = loadTranslationLanguage();
  state.ui.setTranslationLanguage(state.translationLanguage);
  state.ui.bindTranslationLanguageChange(onTranslationLanguageChange);

  renderTenseSettings();

  state.ui.bindNav(onNavigate);
  state.ui.setActiveView(state.view);
  if (state.view === "training") {
    ensureTrainingSession();
  }

  state.ui.setVerbOptions(VERBS);
  state.ui.bindVerbChange(onVerbChange);
  state.ui.bindTenseChange(onTenseChange);

  state.ui.bindTrainingPrimary(onTrainingPrimary);
  state.ui.bindTrainingRefresh(onTrainingRefresh);
  state.ui.bindTrainingInput(onTrainingInputChange);
  state.ui.bindTrainingSubmit(onTrainingSubmit);
  state.ui.bindTrainingFeedback(onTrainingPrimary);

  state.ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });
  state.ui.setTrainingInputValue("");
  state.ui.setTrainingFeedback("", "neutral");
  state.ui.setTrainingSuggestions([]);
  refreshTrainingStats();

  if (VERBS.length) {
    loadVerb(VERBS[0].id);
  } else {
    state.ui.showStatus("No hay verbos configurados.", { isError: true });
  }
}

async function loadVerb(verbId) {
  const verbInfo = VERBS.find((verb) => verb.id === verbId);

  if (!verbInfo) {
    state.ui.showStatus("⚠️ Error: verbo no encontrado.", { isError: true });
    return;
  }

  state.ui.showStatus(`Cargando datos del verbo ${verbInfo.label}…`);
  state.ui.beginVerbLoading();

  try {
    const payload = await fetchVerbData(verbInfo);
    state.data = payload;
    state.currentVerbId = verbId;

    state.ui.selectVerbOption(verbId);
    state.ui.setVerbMeta(payload);

    const tenses = payload.tenses ?? [];
    const hasTenses = state.ui.setTenseOptions(tenses);

    if (hasTenses && tenses.length) {
      state.ui.selectTenseOption(0);
      state.ui.showForms(tenses[0].forms ?? []);
      state.ui.showStatus(`Listo: ${verbInfo.label} cargado.`);
    } else {
      state.ui.showFormsMessage("No hay tiempos para este verbo.");
      state.ui.showStatus(`Listo: ${verbInfo.label} cargado, sin tiempos.`);
    }

    refreshTrainingStats();
    preloadOtherVerbs(verbId);
  } catch (error) {
    state.data = null;
    state.currentVerbId = null;
    state.ui.showFormsMessage("No se pudieron cargar las formas.");
    state.ui.showStatus(`⚠️ Error: ${error.message}`, { isError: true });
  }
}

function onVerbChange(event) {
  const verbId = event.target.value;
  if (verbId && verbId !== state.currentVerbId) {
    loadVerb(verbId);
  }
}

function onTenseChange(event) {
  const index = Number(event.target.selectedOptions[0]?.dataset.index ?? -1);
  const tenses = state.data?.tenses ?? [];

  if (index >= 0 && index < tenses.length) {
    state.ui.selectTenseOption(index);
    state.ui.showForms(tenses[index].forms ?? []);
  }
}

async function fetchVerbData(verbInfo) {
  const verbId = verbInfo.id;

  if (state.cache.has(verbId)) {
    return state.cache.get(verbId);
  }

  if (state.pending.has(verbId)) {
    return state.pending.get(verbId);
  }

  const inlinePayload = resolveInlineVerbPayload(verbInfo);
  if (inlinePayload) {
    return cacheVerbPayload(verbId, inlinePayload);
  }

  const fetchPromise = (async () => {
    const response = await fetch(verbInfo.file);
    if (!response.ok) {
      throw new Error(`No se pudo cargar el archivo (${response.status})`);
    }

    const payload = await response.json();
    return cacheVerbPayload(verbId, payload);
  })();

  state.pending.set(verbId, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    state.pending.delete(verbId);
  }
}

function cacheVerbPayload(verbId, payload) {
  state.cache.set(verbId, payload);
  state.trainingEngine?.registerVerbData(verbId, payload);
  updateTenseCatalog(payload.tenses ?? []);
  refreshTrainingStats();
  return payload;
}

function resolveInlineVerbPayload(verbInfo) {
  const scope = typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : null;

  const store = scope?.__INLINE_VERB_DATA__;
  if (!store) {
    return null;
  }

  const rawPath = (verbInfo.file ?? "").replace(/\\/g, "/");
  if (!rawPath) {
    return null;
  }

  const candidates = new Set([rawPath]);

  if (rawPath.startsWith("./")) {
    candidates.add(rawPath.slice(2));
  } else {
    candidates.add(`./${rawPath}`);
  }

  if (rawPath.startsWith("/")) {
    candidates.add(rawPath.slice(1));
  }

  for (const key of candidates) {
    if (key && store[key]) {
      return store[key];
    }
  }

  return null;
}

function preloadOtherVerbs(excludeId) {
  VERBS.forEach((verb) => {
    if (verb.id === excludeId) {
      return;
    }

    if (!state.cache.has(verb.id) && !state.pending.has(verb.id)) {
      fetchVerbData(verb).catch(() => {
        // Non-blocking prefetch failure.
      });
    }
  });
}

function refreshTrainingStats() {
  if (!state.ui || !state.trainingEngine) {
    return;
  }

  state.ui.updateTrainingStats(state.trainingEngine.getSummary());
  ensureTrainingSession();
}

function getActiveTenseIds() {
  return Array.from(state.tenseOptions.keys()).filter((tenseId) => !state.disabledTenses.has(tenseId));
}

function onTrainingPrimary() {
  const ui = state.ui;
  const trainingEngine = state.trainingEngine;

  if (!ui || !trainingEngine) {
    return;
  }

  if (!state.training.active) {
    startTrainingSession();
    return;
  }

  const card = state.training.currentCard;

  if (!card) {
    loadNextTrainingCard();
    return;
  }

  if (!state.training.answered) {
    const rawInput = ui.getTrainingInputValue().trim();
    if (!rawInput.length) {
      ui.setTrainingPrimaryState({ disabled: true });
      return;
    }

    const normalizedInput = normalizeAnswer(rawInput);
    const expectedEnding = normalizeAnswer(card.ending ?? "");
    const fullForm = composeFullForm(card);
    const normalizedFull = normalizeAnswer(fullForm);
    const isCorrect = normalizedInput === expectedEnding || normalizedInput === normalizedFull;

    trainingEngine.recordAnswer(card.cardId, isCorrect);

    if (isCorrect) {
      ui.setTrainingFeedback(`¡Correcto! ${fullForm}`, "correct");
    } else {
      ui.setTrainingFeedback(`Incorrecto. Forma correcta: ${fullForm}`, "incorrect");
    }

    state.training.answered = true;
    ui.setTrainingPrimaryState({ label: "Siguiente", disabled: false });
    refreshTrainingStats();
    return;
  }

  ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });
  ui.setTrainingInputValue("");
  ui.setTrainingFeedback("", "neutral");
  loadNextTrainingCard();
}

function onTrainingRefresh() {
  const ui = state.ui;
  const trainingEngine = state.trainingEngine;

  if (!ui || !trainingEngine) {
    return;
  }

  if (!trainingEngine.hasCards()) {
    ensureTrainingSession();
    return;
  }

  if (!state.training.active) {
    startTrainingSession();
    return;
  }

  state.training.currentCard = null;
  state.training.answered = false;
  ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });
  ui.setTrainingInputValue("");
  ui.setTrainingFeedback("", "neutral");
  loadNextTrainingCard();
}

function onTrainingInputChange() {
  const ui = state.ui;

  if (!ui) {
    return;
  }

  if (!state.training.currentCard || state.training.answered) {
    ui.setTrainingPrimaryState({ disabled: true });
    return;
  }

  const hasValue = ui.getTrainingInputValue().trim().length > 0;
  ui.setTrainingPrimaryState({ disabled: !hasValue });
}

function onTrainingSubmit() {
  onTrainingPrimary();
}

function startTrainingSession() {
  const ui = state.ui;
  const trainingEngine = state.trainingEngine;

  if (!ui || !trainingEngine) {
    return;
  }

  if (!trainingEngine.hasCards()) {
    state.training.active = false;
    state.training.currentCard = null;
    state.training.answered = true;
    clearTrainingPrompt();
    ui.setTrainingSuggestions([]);
    ui.setTrainingInputValue("");
    ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });
    ui.setTrainingFeedback(getNoCardsMessage(), "neutral");
    return;
  }

  state.training.active = true;
  state.training.currentCard = null;
  state.training.answered = false;

  trainingEngine.resetSessionQueue();
  ui.setTrainingInputValue("");
  ui.setTrainingFeedback("", "neutral");
  ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });

  loadNextTrainingCard();
}

function loadNextTrainingCard() {
  const ui = state.ui;
  const trainingEngine = state.trainingEngine;

  if (!ui || !trainingEngine) {
    return;
  }

  const card = trainingEngine.getNextCard();
  state.training.currentCard = card;
  state.training.answered = false;

  if (!card) {
    clearTrainingPrompt();
    ui.setTrainingInputValue("");
    ui.setTrainingPrimaryState({ label: "Actualizar", disabled: false });
    ui.setTrainingFeedback("No hay tarjetas pendientes ahora mismo.", "neutral");
    state.training.answered = true;
    ui.setTrainingExample("");
    return;
  }

  ui.setTrainingPrompt({
    infinitive: card.infinitive,
    tenseLabel: card.tenseLabel,
    pronoun: card.pronoun,
    stem: card.stem,
    tail: card.tail,
    emoji: card.emoji
  });
  ui.setTrainingExample(getCardContext(card));

  ui.setTrainingSuggestions(card.suggestions ?? [], (ending, meta = {}) => {
    applySuggestion(ending, { submit: Boolean(meta.submit) });
  });

  ui.setTrainingInputValue("");
  ui.setTrainingFeedback("", "neutral");
  ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });
}

function ensureTrainingSession() {
  const ui = state.ui;
  const trainingEngine = state.trainingEngine;

  if (state.view !== "training") {
    return;
  }

  if (!ui || !trainingEngine) {
    return;
  }

  if (!trainingEngine.hasCards()) {
    state.training.active = false;
    state.training.currentCard = null;
    state.training.answered = true;
    clearTrainingPrompt();
    ui.setTrainingInputValue("");
    ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });
    ui.setTrainingFeedback(getNoCardsMessage(), "neutral");
    ui.setTrainingSuggestions([]);
    return;
  }

  if (!state.training.active) {
    startTrainingSession();
    return;
  }

  if (!state.training.currentCard && !state.training.answered) {
    loadNextTrainingCard();
  }
}

function clearTrainingPrompt() {
  state.ui?.setTrainingPrompt({
    infinitive: "",
    tenseLabel: "",
    pronoun: "",
    stem: "",
    tail: "",
    emoji: ""
  });
  state.ui?.setTrainingExample("");
  state.ui?.setTrainingSuggestions([]);
}

function composeFullForm(card) {
  return `${card.stem ?? ""}${card.ending ?? ""}${card.tail ?? ""}`;
}

function applySuggestion(value, { submit = false } = {}) {
  const ui = state.ui;

  if (!ui) {
    return;
  }

  if (!state.training.currentCard) {
    return;
  }

  const suggestionValue = typeof value === "string" ? value : "";
  ui.setTrainingInputValue(suggestionValue);
  onTrainingInputChange();
  ui.focusTrainingPrimary();

  if (!submit || !suggestionValue.trim()) {
    return;
  }

  window.setTimeout(() => {
    onTrainingPrimary();
  }, 0);
}

function normalizeAnswer(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .trim()
    .toLowerCase();
}

function onTenseFilterToggle(tenseId, isEnabled) {
  if (!tenseId) {
    return;
  }

  if (isEnabled) {
    state.disabledTenses.delete(tenseId);
  } else {
    state.disabledTenses.add(tenseId);
  }

  saveDisabledTenses(state.disabledTenses);
  state.trainingEngine?.setExcludedTenses(state.disabledTenses);

  state.training.active = false;
  state.training.currentCard = null;
  state.training.answered = false;

  refreshTrainingStats();
}

function renderTenseSettings() {
  if (!state.ui) {
    return;
  }

  const items = Array.from(state.tenseOptions.entries()).map(([id, info]) => ({
    id,
    label: info?.label ?? id
  }));

  items.sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));

  state.ui.renderTrainingTenseFilters(items, {
    excluded: state.disabledTenses,
    onToggle: onTenseFilterToggle
  });
}

function updateTenseCatalog(tenses = []) {
  if (!Array.isArray(tenses)) {
    return;
  }

  let changed = false;

  tenses.forEach((tense, index) => {
    const tenseId = sanitizeTenseId(tense, index);
    if (!tenseId) {
      return;
    }

    const label = buildTenseLabel(tense);
    const existing = state.tenseOptions.get(tenseId);
    if (!existing || existing.label !== label) {
      state.tenseOptions.set(tenseId, { label });
      changed = true;
    }
  });

  if (changed) {
    renderTenseSettings();
  }
}

function loadDisabledTenses() {
  try {
    const stored = localStorage.getItem(DISABLED_TENSES_KEY);
    if (!stored) {
      return new Set();
    }

    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      const items = parsed
        .map((value) => (typeof value === "string" ? slugifyId(value) : ""))
        .filter((value) => value && value.trim().length);
      return new Set(items);
    }
  } catch (error) {
    console.warn("No se pudo leer la configuración de tiempos", error);
  }

  return new Set();
}

function saveDisabledTenses(collection) {
  try {
    const values = Array.from(collection ?? [])
      .map((value) => (typeof value === "string" ? slugifyId(value) : ""))
      .filter((value) => value);
    localStorage.setItem(DISABLED_TENSES_KEY, JSON.stringify(values));
  } catch (error) {
    console.warn("No se pudo guardar la configuración de tiempos", error);
  }
}

function getNoCardsMessage() {
  if (!state.trainingEngine) {
    return "Añade más verbos para empezar a practicar.";
  }

  if (state.trainingEngine.hasRegisteredCards()) {
    return "No hay tiempos activos en el entrenador. Activa más tiempos en Ajustes.";
  }

  return "Añade más verbos para empezar a practicar.";
}

function sanitizeTenseId(tense, index) {
  const baseId = tense?.id ?? `${tense?.mood ?? ""}-${tense?.tense ?? index}`;
  return slugifyId(baseId);
}

function buildTenseLabel(tense) {
  if (tense?.label) {
    return tense.label;
  }

  const parts = [tense?.mood, tense?.tense].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Tiempo";
}

function slugifyId(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function onNavigate(viewId) {
  if (!viewId || state.view === viewId) {
    return;
  }

  state.view = viewId;
  state.ui?.setActiveView(viewId);
  ensureTrainingSession();
}

function onThemeChange(nextTheme) {
  const resolvedTheme = ["light", "dark", "system"].includes(nextTheme) ? nextTheme : DEFAULT_THEME;
  state.theme = resolvedTheme;
  applyTheme(resolvedTheme);
  state.ui?.setThemeSelection(resolvedTheme);
  saveThemePreference(resolvedTheme);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme ?? DEFAULT_THEME;
}

function onTranslationLanguageChange(nextLanguage) {
  const normalized = normalizeTranslationLanguage(nextLanguage);
  state.translationLanguage = normalized;
  saveTranslationLanguage(normalized);
  state.ui?.setTranslationLanguage(normalized);
  updateTrainingExample();
}

function loadThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (["light", "dark", "system"].includes(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn("No se pudo leer el tema guardado", error);
  }

  return DEFAULT_THEME;
}

function saveThemePreference(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("No se pudo guardar el tema", error);
  }
}

function onResetStats() {
  const ui = state.ui;
  const trainingEngine = state.trainingEngine;

  if (!ui || !trainingEngine) {
    return;
  }

  trainingEngine.resetStats();
  trainingEngine.resetSessionQueue();

  state.training.active = false;
  state.training.currentCard = null;
  state.training.answered = false;

  clearTrainingPrompt();
  ui.setTrainingPrimaryState({ label: "Comprobar", disabled: true });
  ui.setTrainingInputValue("");
  ui.setTrainingFeedback("Estadísticas reiniciadas. Comienza una nueva sesión.", "neutral");

  refreshTrainingStats();
}

function loadTranslationLanguage() {
  try {
    const stored = localStorage.getItem(TRANSLATION_LANGUAGE_KEY);
    if (stored) {
      return normalizeTranslationLanguage(stored);
    }
  } catch (error) {
    console.warn("No se pudo leer el idioma de ejemplo guardado", error);
  }

  return DEFAULT_TRANSLATION_LANGUAGE;
}

function saveTranslationLanguage(language) {
  try {
    localStorage.setItem(TRANSLATION_LANGUAGE_KEY, normalizeTranslationLanguage(language));
  } catch (error) {
    console.warn("No se pudo guardar el idioma de ejemplo", error);
  }
}

function normalizeTranslationLanguage(value) {
  return value === "eng" ? "eng" : "ru";
}

function getCardContext(card) {
  if (!card) {
    return "";
  }

  const language = state.translationLanguage;
  const primary = language === "eng" ? card.contextEng : card.contextRu;
  if (primary && primary.trim()) {
    return primary.trim();
  }

  const fallback = language === "eng" ? card.contextRu : card.contextEng;
  return typeof fallback === "string" ? fallback.trim() : "";
}

function updateTrainingExample() {
  const example = getCardContext(state.training.currentCard);
  state.ui?.setTrainingExample(example);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("No se pudo registrar el service worker", error);
    });
  });
}
