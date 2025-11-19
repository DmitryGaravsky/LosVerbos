const STORAGE_KEY = "losVerbos-srs-v1";
const RETRY_INTERVAL = 30 * 1000;
const INTERVALS = [0, 60 * 1000, 5 * 60 * 1000, 25 * 60 * 1000, 4 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const BATCH_SIZE = 2;

export class TrainingEngine {
  constructor({ storageKey = STORAGE_KEY } = {}) {
    this.storageKey = storageKey;
    this.cards = new Map();
    this.stats = this._loadStats();
    this.excludedTenses = new Set();
    this.session = {
      queue: [],
      lastVerbId: null,
      currentCardId: null
    };
  }

  registerVerbData(verbId, verbData) {
    if (!verbId || !verbData) {
      return;
    }

    const tenses = Array.isArray(verbData.tenses) ? verbData.tenses : [];
    const infinitiveRaw = verbData.infinitive ?? "";
    const infinitiveDisplay = stripBrackets(infinitiveRaw);
    const verbFamily = typeof verbData.metadata?.family === "string" ? verbData.metadata.family : "";
    const verbEmoji = typeof verbData.emoji === "string" ? verbData.emoji : "";

    tenses.forEach((tense, tenseIndex) => {
      const forms = Array.isArray(tense?.forms) ? tense.forms : [];
      const tenseId = sanitizeId(tense?.id ?? `${tense?.mood ?? ""}-${tense?.tense ?? tenseIndex}`);
      const tenseLabel = tense?.label ?? `${tense?.mood ?? ""} ${tense?.tense ?? ""}`.trim();

      forms.forEach((formEntry, formIndex) => {
        const cardId = buildCardId(verbId, tenseId, formEntry?.pronoun, formIndex);
        const parsed = parseForm(formEntry?.form);

        this.cards.set(cardId, {
          cardId,
          verbId,
          infinitive: infinitiveDisplay,
          rawInfinitive: infinitiveRaw,
          tenseId,
          tenseLabel,
          verbFamily,
          emoji: verbEmoji,
          pronoun: formEntry?.pronoun ?? "",
          stem: parsed.stem,
          tail: parsed.tail,
          ending: parsed.ending,
          fullForm: formEntry?.form ?? "",
          description: tense?.description ?? "",
          contextRu: typeof formEntry?.ru === "string" ? formEntry.ru.trim() : "",
          contextEng: typeof formEntry?.eng === "string" ? formEntry.eng.trim() : ""
        });

        this._ensureStat(cardId);
      });
    });

    this._cleanupStaleStats();
    this._persistStats();
    this.resetSessionQueue();
  }

  setExcludedTenses(excluded = []) {
    this.excludedTenses = new Set();

    if (Array.isArray(excluded) || excluded instanceof Set) {
      for (const value of excluded) {
        if (typeof value === "string" && value.trim()) {
          const normalized = slugify(value.trim());
          if (normalized) {
            this.excludedTenses.add(normalized);
          }
        }
      }
    }

    this.resetSessionQueue();
  }

  hasCards() {
    for (const card of this.cards.values()) {
      if (!this._isExcluded(card.tenseId)) {
        return true;
      }
    }

    return false;
  }

  hasRegisteredCards() {
    return this.cards.size > 0;
  }

  getNextCard() {
    if (!this.cards.size) {
      return null;
    }

    if (!this.session.queue.length) {
      this._refillQueue();
    }

    let next = this.session.queue.shift();

    while (next && this._isExcluded(next.tenseId)) {
      next = this.session.queue.shift();
    }

    if (!next) {
      return null;
    }

    this.session.currentCardId = next.cardId;
    this.session.lastVerbId = next.verbId;

    const stat = this._ensureStat(next.cardId);
    const suggestions = this._getSuggestionsFor(next);

    return {
      cardId: next.cardId,
      verbId: next.verbId,
      infinitive: next.infinitive,
      rawInfinitive: next.rawInfinitive,
      tenseLabel: next.tenseLabel,
      verbFamily: next.verbFamily,
      emoji: next.emoji,
      pronoun: next.pronoun,
      stem: next.stem,
      tail: next.tail,
      ending: next.ending,
      fullForm: next.fullForm,
      description: next.description,
      contextRu: next.contextRu,
      contextEng: next.contextEng,
      suggestions,
      stats: {
        stage: stat.stage,
        correct: stat.correct,
        incorrect: stat.incorrect,
        streak: stat.streak,
        due: stat.due
      }
    };
  }

  recordAnswer(cardId, isCorrect) {
    const stat = this._ensureStat(cardId);
    const now = Date.now();

    if (isCorrect) {
      stat.correct += 1;
      stat.streak += 1;
      stat.stage = Math.min(stat.stage + 1, INTERVALS.length - 1);
      stat.due = now + INTERVALS[stat.stage];
    } else {
      stat.incorrect += 1;
      stat.streak = 0;
      stat.stage = 0;
      stat.due = now + RETRY_INTERVAL;
    }

    stat.lastReview = now;

    this._persistStats();
  }

  resetSessionQueue() {
    this.session.queue = [];
    this.session.currentCardId = null;
    this.session.lastVerbId = null;
  }

  getSummary() {
    const now = Date.now();
    let dueCount = 0;
    let correct = 0;
    let incorrect = 0;
    let total = 0;

    this.cards.forEach((card, cardId) => {
      if (this._isExcluded(card.tenseId)) {
        return;
      }

      const stat = this._ensureStat(cardId);
      total += 1;

      if (stat.due <= now) {
        dueCount += 1;
      }
      correct += stat.correct;
      incorrect += stat.incorrect;
    });

    const attempts = correct + incorrect;
    const accuracy = attempts ? correct / attempts : null;

    return {
      totalCount: total,
      dueCount,
      accuracy
    };
  }

  resetStats() {
    this.stats = {};
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch (error) {
      // ignore storage issues
    }

    this.resetSessionQueue();
  }

  _refillQueue() {
    const now = Date.now();
    const candidates = [];

    this.cards.forEach((card, cardId) => {
      if (this._isExcluded(card.tenseId)) {
        return;
      }
      const stat = this._ensureStat(cardId);
      candidates.push({
        cardId,
        verbId: card.verbId,
        card,
        stat
      });
    });

    if (!candidates.length) {
      this.session.queue = [];
      return;
    }

    const dueCards = candidates.filter((entry) => entry.stat.due <= now);
    let pool = dueCards.length
      ? dueCards
      : candidates
          .slice()
          .sort((a, b) => a.stat.due - b.stat.due)
          .slice(0, Math.min(6, candidates.length));

    pool = shuffle(pool);

    const queue = [];
    const usedVerbs = new Set();
    const lastVerb = this.session.lastVerbId;

    for (const entry of pool) {
      if (queue.length >= BATCH_SIZE) {
        break;
      }

      if (!queue.length && lastVerb && entry.verbId === lastVerb && pool.length > 1) {
        continue;
      }

      if (usedVerbs.has(entry.verbId) && pool.length > BATCH_SIZE) {
        continue;
      }

      queue.push({ ...entry.card });
      usedVerbs.add(entry.verbId);
    }

    if (!queue.length && pool.length) {
      queue.push({ ...pool[0].card });
    }

    this.session.queue = queue;
  }

  _getSuggestionsFor(card) {
    if (!card) {
      return [];
    }

    const targetFamily = card.verbFamily ?? "";
    const targetVerb = card.verbId;
    const targetTense = card.tenseId;
    const currentEnding = card.ending ?? "";

    const endings = [];

    this.cards.forEach((entry) => {
      if (this._isExcluded(entry.tenseId)) {
        return;
      }

      if (!entry.ending) {
        return;
      }

      const sameTense = entry.tenseId === targetTense;
      if (!sameTense) {
        return;
      }

      const sameFamily = targetFamily ? entry.verbFamily === targetFamily : entry.verbId === targetVerb;
      if (!sameFamily) {
        return;
      }

      if (!endings.includes(entry.ending)) {
        endings.push(entry.ending);
      }
    });

    if (currentEnding) {
      const index = endings.indexOf(currentEnding);
      if (index >= 0) {
        endings.splice(index, 1);
      }
      endings.push(currentEnding);
    }

    return shuffle(endings);
  }

  _ensureStat(cardId) {
    if (!this.stats[cardId]) {
      this.stats[cardId] = {
        stage: 0,
        due: Date.now(),
        correct: 0,
        incorrect: 0,
        streak: 0,
        lastReview: null
      };
    }

    return this.stats[cardId];
  }

  _cleanupStaleStats() {
    const validIds = new Set(this.cards.keys());
    Object.keys(this.stats).forEach((cardId) => {
      if (!validIds.has(cardId)) {
        delete this.stats[cardId];
      }
    });
  }

  _isExcluded(tenseId) {
    if (!tenseId) {
      return false;
    }

    return this.excludedTenses.has(tenseId);
  }

  _loadStats() {
    try {
      const stored = window.localStorage.getItem(this.storageKey);
      if (!stored) {
        return {};
      }

      const parsed = JSON.parse(stored);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  _persistStats() {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.stats));
    } catch (error) {
      // ignore persistence failures (private mode, etc.)
    }
  }
}

function buildCardId(verbId, tenseId, pronoun, index) {
  const normalizedPronoun = slugify(pronoun ?? `idx-${index}`);
  return `${verbId}::${tenseId}::${normalizedPronoun}`;
}

function parseForm(formText) {
  if (typeof formText !== "string") {
    return { stem: formText ?? "", ending: "", tail: "" };
  }

  const match = formText.match(/^(.*)\[(.*)\](.*)$/);
  if (!match) {
    return { stem: formText, ending: "", tail: "" };
  }

  return {
    stem: match[1] ?? "",
    ending: match[2] ?? "",
    tail: match[3] ?? ""
  };
}

function stripBrackets(text) {
  return typeof text === "string" ? text.replace(/[\[\]]/g, "") : text;
}

function sanitizeId(value) {
  return slugify(value ?? "id");
}

function slugify(value) {
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

function shuffle(list) {
  const array = list.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
