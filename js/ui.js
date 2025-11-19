export class UIController {
  constructor(root = document) {
    this.root = root;
    this.doc = root.ownerDocument ?? root;
    this.refs = {
      navButtons: Array.from(root.querySelectorAll(".nav-item[data-view-target], .app-title__link[data-view-target]")),
      views: Array.from(root.querySelectorAll(".view[data-view]")),
      infinitive: root.getElementById("infinitive"),
      translation: root.getElementById("translation"),
      verbType: root.getElementById("verbType"),
      referenceHeading: root.getElementById("referenceHeading"),
      referenceEmoji: root.getElementById("referenceEmoji"),
      verbSelect: root.getElementById("verbSelect"),
      tenseSelect: root.getElementById("tenseSelect"),
      forms: root.getElementById("forms"),
      status: root.getElementById("status"),
      trainerPrimary: root.getElementById("trainerPrimary"),
      trainerRefresh: root.getElementById("trainerRefresh"),
      trainerInfinitive: root.getElementById("trainerInfinitive"),
      trainerTense: root.getElementById("trainerTense"),
      trainerEmoji: root.getElementById("trainerEmoji"),
      trainerPronoun: root.getElementById("trainerPronoun"),
      trainerStem: root.getElementById("trainerStem"),
      trainerTail: root.getElementById("trainerTail"),
      trainerInput: root.getElementById("trainerInput"),
      trainerFeedback: root.getElementById("trainerFeedback"),
      trainerSuggestions: root.getElementById("trainerSuggestions"),
      trainerExample: root.getElementById("trainerExample"),
      trainerExampleText: root.getElementById("trainerExampleText"),
      trainerDue: root.getElementById("trainerDue"),
      trainerAccuracy: root.getElementById("trainerAccuracy"),
      trainerProgressFill: root.getElementById("trainerProgressFill"),
      themeRadios: Array.from(root.querySelectorAll('input[name="theme"]')),
      translationLanguageRadios: Array.from(root.querySelectorAll('input[name="translationLanguage"]')),
      resetStats: root.getElementById("resetStats"),
      settingsTenseList: root.getElementById("settingsTenseList")
    };
  }

  bindNav(handler) {
    this.refs.navButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const viewId = button.dataset.viewTarget;
        handler?.(viewId);
      });
    });
  }

  setActiveView(viewId) {
    this.refs.views.forEach((section) => {
      if (section.dataset.view === viewId) {
        section.removeAttribute("hidden");
      } else {
        section.setAttribute("hidden", "hidden");
      }
    });

    this.refs.navButtons.forEach((button) => {
      const isActive = button.dataset.viewTarget === viewId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });
  }

  bindVerbChange(handler) {
    this.refs.verbSelect?.addEventListener("change", handler);
  }

  bindTenseChange(handler) {
    this.refs.tenseSelect?.addEventListener("change", handler);
  }

  setVerbOptions(verbs) {
    if (!this.refs.verbSelect) {
      return;
    }

    this.refs.verbSelect.innerHTML = "";

    if (!Array.isArray(verbs) || !verbs.length) {
      const option = this.doc.createElement("option");
      option.textContent = "Sin verbos";
      this.refs.verbSelect.appendChild(option);
      this.refs.verbSelect.disabled = true;
      return;
    }

    verbs.forEach((verb) => {
      const option = this.doc.createElement("option");
      option.value = verb.id;
      option.textContent = verb.label;
      this.refs.verbSelect.appendChild(option);
    });

    this.refs.verbSelect.disabled = false;
  }

  selectVerbOption(verbId) {
    if (this.refs.verbSelect) {
      this.refs.verbSelect.value = verbId ?? "";
    }
  }

  beginVerbLoading(message) {
    if (!this.refs.tenseSelect || !this.refs.forms) {
      return;
    }

    this.refs.tenseSelect.innerHTML = "";
    this.refs.tenseSelect.disabled = true;
    this.refs.forms.textContent = message ?? "Cargando formas…";
  }

  setVerbMeta(verbData) {
    if (!this.refs.infinitive || !this.refs.translation || !this.refs.verbType) {
      return;
    }

    this.refs.infinitive.innerHTML = "";
    this._renderTextWithEnding(verbData.infinitive, this.refs.infinitive);

    if (this.refs.referenceHeading) {
      this.refs.referenceHeading.innerHTML = "";
      if (verbData.infinitive) {
        this._renderTextWithEnding(verbData.infinitive, this.refs.referenceHeading);
      } else {
        this.refs.referenceHeading.textContent = "—";
      }
    }

    if (this.refs.referenceEmoji) {
      const emoji = typeof verbData.emoji === "string" ? verbData.emoji : "";
      this.refs.referenceEmoji.textContent = emoji ?? "";
      this.refs.referenceEmoji.classList.toggle("is-empty", !emoji);
    }

    const translations = Array.isArray(verbData.translations) ? verbData.translations : [];
    this.refs.translation.textContent = translations.length ? translations.join(", ") : "—";

    this.refs.verbType.textContent = `${verbData.metadata?.verbType ?? "—"} ${verbData.metadata?.family ?? ""}`.trim();
  }

  renderTrainingTenseFilters(tenses = [], { excluded = new Set(), onToggle } = {}) {
    const container = this.refs.settingsTenseList;
    if (!container) {
      return;
    }

    container.innerHTML = "";

    const list = Array.isArray(tenses) ? tenses : [];
    const excludedSet = excluded instanceof Set ? excluded : new Set(excluded ?? []);

    if (!list.length) {
      const placeholder = this.doc.createElement("p");
      placeholder.className = "tense-filter-empty";
      placeholder.textContent = "Carga un verbo para ver los tiempos disponibles.";
      container.appendChild(placeholder);
      return;
    }

    list.forEach(({ id, label }) => {
      if (!id) {
        return;
      }

      const option = this.doc.createElement("label");
      option.className = "tense-filter";
      option.dataset.tenseId = id;

      const input = this.doc.createElement("input");
      input.type = "checkbox";
      input.value = id;
      input.checked = !excludedSet.has(id);
      input.setAttribute("aria-label", label ?? id);

      const text = this.doc.createElement("span");
      text.textContent = label ?? id;

      option.classList.toggle("is-disabled", !input.checked);

      input.addEventListener("change", () => {
        option.classList.toggle("is-disabled", !input.checked);
        onToggle?.(id, input.checked);
      });

      option.appendChild(input);
      option.appendChild(text);
      container.appendChild(option);
    });
  }

  setTenseOptions(tenses) {
    if (!this.refs.tenseSelect) {
      return false;
    }

    this.refs.tenseSelect.innerHTML = "";

    if (!Array.isArray(tenses) || !tenses.length) {
      this.refs.tenseSelect.disabled = true;
      const option = this.doc.createElement("option");
      option.textContent = "Sin tiempos disponibles";
      this.refs.tenseSelect.appendChild(option);
      return false;
    }

    this.refs.tenseSelect.disabled = false;

    tenses.forEach((tense, index) => {
      const option = this.doc.createElement("option");
      option.value = tense.id ?? String(index);
      option.textContent = tense.label ?? `${tense.mood ?? ""} ${tense.tense ?? ""}`.trim();
      option.dataset.index = index;
      this.refs.tenseSelect.appendChild(option);
    });

    return true;
  }

  selectTenseOption(index) {
    if (this.refs.tenseSelect) {
      this.refs.tenseSelect.selectedIndex = index;
    }
  }

  showForms(forms) {
    if (!this.refs.forms) {
      return;
    }

    this.refs.forms.innerHTML = "";

    if (!Array.isArray(forms) || !forms.length) {
      this.showFormsMessage("No hay formas disponibles para este tiempo.");
      return;
    }

    const table = this.doc.createElement("table");
    const tbody = this.doc.createElement("tbody");

    forms.forEach((entry) => {
      const row = this.doc.createElement("tr");

      const pronounCell = this.doc.createElement("th");
      pronounCell.textContent = entry.pronoun ?? "";

      const formCell = this.doc.createElement("td");
      this._renderTextWithEnding(entry.form ?? "", formCell);

      row.appendChild(pronounCell);
      row.appendChild(formCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    this.refs.forms.appendChild(table);
  }

  showFormsMessage(message) {
    if (this.refs.forms) {
      this.refs.forms.textContent = message;
    }
  }

  showStatus(message, { isError = false } = {}) {
    if (!this.refs.status) {
      return;
    }

    this.refs.status.textContent = message;
    this.refs.status.classList.toggle("status--error", Boolean(isError));
  }

  bindTrainingPrimary(handler) {
    this.refs.trainerPrimary?.addEventListener("click", handler);
  }

  bindTrainingFeedback(handler) {
    const feedback = this.refs.trainerFeedback;
    if (!feedback) {
      return;
    }

    const trigger = (event) => {
      if (event.type === "click" && event.detail > 1) {
        return;
      }

      event.preventDefault();
      handler?.(event);
    };

    feedback.addEventListener("click", trigger);
  }

  bindTrainingRefresh(handler) {
    this.refs.trainerRefresh?.addEventListener("click", handler);
  }

  bindTrainingInput(handler) {
    this.refs.trainerInput?.addEventListener("input", handler);
  }

  bindTrainingSubmit(handler) {
    this.refs.trainerInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handler(event);
      }
    });
  }

  setTrainingPrompt({ infinitive, tenseLabel, pronoun, stem, tail, emoji }) {
    if (this.refs.trainerInfinitive) {
      this.refs.trainerInfinitive.textContent = infinitive ?? "";
    }

    if (this.refs.trainerTense) {
      const label = tenseLabel ?? "";
      this.refs.trainerTense.textContent = label;
      this.refs.trainerTense.classList.toggle("is-empty", !label.trim());
    }

    if (this.refs.trainerEmoji) {
      const hasEmoji = Boolean(emoji);
      this.refs.trainerEmoji.textContent = hasEmoji ? emoji : "";
      this.refs.trainerEmoji.classList.toggle("is-empty", !hasEmoji);
    }

    if (this.refs.trainerPronoun) {
      this.refs.trainerPronoun.textContent = pronoun ?? "";
    }

    if (this.refs.trainerStem) {
      this.refs.trainerStem.textContent = stem ?? "";
    }

    if (this.refs.trainerTail) {
      this.refs.trainerTail.textContent = tail ?? "";
    }
  }

  setTrainingInputValue(value) {
    if (this.refs.trainerInput) {
      this.refs.trainerInput.value = value ?? "";
    }
  }

  getTrainingInputValue() {
    return this.refs.trainerInput?.value ?? "";
  }

  focusTrainingInput() {
    const input = this.refs.trainerInput;
    if (!input) {
      return;
    }

    if (typeof input.focus === "function") {
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        input.focus();
      }
    }
  }

  focusTrainingPrimary() {
    const button = this.refs.trainerPrimary;
    if (!button) {
      return;
    }

    if (typeof button.focus === "function") {
      try {
        button.focus({ preventScroll: true });
      } catch (error) {
        button.focus();
      }
    }
  }

  setTrainingFeedback(message, status = "neutral") {
    if (!this.refs.trainerFeedback) {
      return;
    }

    const feedback = this.refs.trainerFeedback;
    const content = message ?? "";
    const hasContent = Boolean(content.trim());

    feedback.textContent = content;
    feedback.classList.toggle("is-visible", hasContent);

    const isCorrect = status === "correct" && hasContent;
    const isIncorrect = status === "incorrect" && hasContent;

    feedback.classList.toggle("is-correct", isCorrect);
    feedback.classList.toggle("is-incorrect", isIncorrect);
  }

  setTrainingPrimaryState({ disabled, label }) {
    if (!this.refs.trainerPrimary) {
      return;
    }

    if (typeof disabled === "boolean") {
      this.refs.trainerPrimary.disabled = disabled;
    }

    if (typeof label === "string") {
      this.refs.trainerPrimary.textContent = label;
    }
  }

  setTrainingSuggestions(endings = [], handler) {
    const container = this.refs.trainerSuggestions;
    if (!container) {
      return;
    }

    container.innerHTML = "";

    const list = Array.isArray(endings) ? endings.filter(Boolean) : [];
    if (!list.length) {
      container.setAttribute("hidden", "hidden");
      return;
    }

    container.removeAttribute("hidden");

    list.forEach((ending) => {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "trainer-suggestion";
      button.textContent = ending;
      button.dataset.value = ending;
      button.setAttribute("aria-label", `Completar con "${ending}"`);
      button.title = `Completar con "${ending}"`;

      const DOUBLE_TAP_MS = 320;
      let lastTouchTime = 0;
      let shouldSubmitFromTouch = false;

      button.addEventListener("pointerup", (event) => {
        if (event.pointerType !== "touch") {
          return;
        }

        const now = event.timeStamp || Date.now();
        shouldSubmitFromTouch = now - lastTouchTime <= DOUBLE_TAP_MS;
        lastTouchTime = now;
      });

      button.addEventListener("click", (event) => {
        const isDouble = shouldSubmitFromTouch || event.detail > 1;
        shouldSubmitFromTouch = false;
        handler?.(ending, { submit: isDouble, event });
      });

      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handler?.(ending, { submit: false, event });
        }
        if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          handler?.(ending, { submit: false, event });
        }
      });

      container.appendChild(button);
    });
  }

  updateTrainingStats({ dueCount = 0, totalCount = 0, accuracy = null } = {}) {
    if (this.refs.trainerDue) {
      this.refs.trainerDue.textContent = `Pendientes: ${dueCount}/${totalCount}`;
    }

    if (this.refs.trainerAccuracy) {
      if (accuracy === null || Number.isNaN(accuracy)) {
        this.refs.trainerAccuracy.textContent = "Precisión: —";
      } else {
        const percentage = Math.round(accuracy * 100);
        this.refs.trainerAccuracy.textContent = `Precisión: ${percentage}%`;
      }
    }

    if (this.refs.trainerProgressFill) {
      const ratio = totalCount > 0 ? Math.max(0, Math.min(1, (totalCount - dueCount) / totalCount)) : 0;
      const percent = Math.round(ratio * 100);
      this.refs.trainerProgressFill.style.width = `${percent}%`;
      const progressContainer = this.refs.trainerProgressFill.parentElement;
      if (progressContainer) {
        progressContainer.setAttribute("title", `Completado: ${percent}%`);
      }
    }
  }

  bindThemeChange(handler) {
    this.refs.themeRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          handler?.(radio.value);
        }
      });
    });
  }

  setThemeSelection(targetTheme) {
    this.refs.themeRadios.forEach((radio) => {
      radio.checked = radio.value === targetTheme;
    });
  }

  bindTranslationLanguageChange(handler) {
    this.refs.translationLanguageRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          handler?.(radio.value);
        }
      });
    });
  }

  setTranslationLanguage(language) {
    this.refs.translationLanguageRadios.forEach((radio) => {
      radio.checked = radio.value === language;
    });
  }

  bindResetStats(handler) {
    this.refs.resetStats?.addEventListener("click", handler);
  }

  setTrainingExample(text) {
    const container = this.refs.trainerExample;
    let textNode = this.refs.trainerExampleText;
    if (!container) {
      return;
    }

    const content = typeof text === "string" ? text.trim() : "";
    if (!content) {
      if (textNode) {
        textNode.textContent = "";
      }
      container.setAttribute("hidden", "hidden");
      return;
    }

    if (!textNode) {
      textNode = this.doc.createElement("p");
      textNode.className = "trainer-example-text";
      container.appendChild(textNode);
      this.refs.trainerExampleText = textNode;
    }

    this._renderMarkdownText(content, textNode);
    container.removeAttribute("hidden");
  }

  _renderTextWithEnding(text, targetNode) {
    if (!targetNode) {
      return;
    }

    targetNode.textContent = "";
    const match = typeof text === "string" ? text.match(/^(.*)\[(.*)\](.*)$/) : null;

    if (!match) {
      targetNode.textContent = text ?? "";
      return;
    }

    const [, start, ending, rest] = match;
    targetNode.appendChild(this.doc.createTextNode(start));

    const endingSpan = this.doc.createElement("span");
    endingSpan.className = "ending";
    endingSpan.textContent = ending;
    targetNode.appendChild(endingSpan);

    if (rest) {
      targetNode.appendChild(this.doc.createTextNode(rest));
    }
  }

  _renderMarkdownText(text, targetNode) {
    if (!targetNode) {
      return;
    }

    const content = typeof text === "string" ? text : "";
    targetNode.textContent = "";

    const boldPattern = /\*\*([^*]+)\*\*/g;
    let lastIndex = 0;
    let match;

    while ((match = boldPattern.exec(content)) !== null) {
      if (match.index > lastIndex) {
        targetNode.appendChild(
          this.doc.createTextNode(content.slice(lastIndex, match.index))
        );
      }

      const strong = this.doc.createElement("strong");
      strong.textContent = match[1];
      targetNode.appendChild(strong);

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      targetNode.appendChild(
        this.doc.createTextNode(content.slice(lastIndex))
      );
    }
  }
}
