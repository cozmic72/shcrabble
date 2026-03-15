// Internationalization system for Shcrabble
class I18n {
  constructor() {
    this.currentLang = localStorage.getItem('shcrabble-lang') || 'en';
    this.translations = {};
    this.aboutContent = {};
    this.welcomeContent = {};
    this.rulesContent = {};
  }

  async init() {
    // Load both languages
    await this.loadLanguage('en');
    await this.loadLanguage('shaw');
    await this.loadAbout('en');
    await this.loadAbout('shaw');
    await this.loadWelcome('en');
    await this.loadWelcome('shaw');
    await this.loadRules('en');
    await this.loadRules('shaw');
  }

  async loadLanguage(lang) {
    try {
      const response = await fetch(`/shcrabble/i18n/${lang}.json`);
      this.translations[lang] = await response.json();
    } catch (err) {
      console.error(`Failed to load language ${lang}:`, err);
    }
  }

  async loadAbout(lang) {
    try {
      const response = await fetch(`/shcrabble/i18n/about-${lang}.html`);
      this.aboutContent[lang] = await response.text();
    } catch (err) {
      console.error(`Failed to load about content for ${lang}:`, err);
    }
  }

  async loadWelcome(lang) {
    try {
      const response = await fetch(`/shcrabble/i18n/welcome-${lang}.html`);
      this.welcomeContent[lang] = await response.text();
    } catch (err) {
      console.error(`Failed to load welcome content for ${lang}:`, err);
    }
  }

  async loadRules(lang) {
    try {
      const response = await fetch(`/shcrabble/i18n/rules-${lang}.html`);
      this.rulesContent[lang] = await response.text();
    } catch (err) {
      console.error(`Failed to load rules content for ${lang}:`, err);
    }
  }

  setLanguage(lang) {
    this.currentLang = lang;
    localStorage.setItem('shcrabble-lang', lang);
    this.updateAllText();
  }

  getLanguage() {
    return this.currentLang;
  }

  t(key, replacements = {}) {
    let text = this.translations[this.currentLang]?.[key] || key;

    // Replace placeholders like {name}, {count}, {score}
    for (const [placeholder, value] of Object.entries(replacements)) {
      text = text.replace(`{${placeholder}}`, value);
    }

    return text;
  }

  getAbout() {
    return this.aboutContent[this.currentLang] || '';
  }

  getWelcome() {
    return this.welcomeContent[this.currentLang] || '';
  }

  getRules() {
    return this.rulesContent[this.currentLang] || '';
  }

  updateAllText() {
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');

      // Check if it's a placeholder attribute
      const placeholderAttr = el.getAttribute('data-i18n-placeholder');
      if (placeholderAttr) {
        el.placeholder = this.t(key);
      } else {
        el.textContent = this.t(key);
      }
    });

    // Update bonus square labels
    this.updateBonusLabels();
  }

  updateBonusLabels() {
    document.querySelectorAll('.bonus-label').forEach(label => {
      const bonusType = label.getAttribute('data-bonus');
      if (bonusType) {
        label.textContent = this.t(`bonus${bonusType}`);
      }
    });
  }
}

// Global i18n instance
const i18n = new I18n();
