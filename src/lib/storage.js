/**
 * STORAGE SERVICE
 * ===============
 * Centralized chrome.storage abstraction layer.
 * All reads/writes go through here.
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
  LICENSE:          'asmp_license',
  LICENSE_CACHE:    'asmp_license_cache',
  INSTALLATION_ID:  'asmp_installation_id',
  SETTINGS:         'asmp_settings',
  DAILY_USAGE:      'asmp_daily_usage',
  METADATA_HISTORY: 'asmp_metadata_history',
  PROMPT_PROFILES:  'asmp_prompt_profiles',
  BATCH_QUEUE:      'asmp_batch_queue',
  ONBOARDING_DONE:  'asmp_onboarding_done',
};

const StorageService = {

  // ── INSTALLATION ID ────────────────────────────────────────────────────

  async getInstallationId() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.INSTALLATION_ID);
    if (result[STORAGE_KEYS.INSTALLATION_ID]) {
      return result[STORAGE_KEYS.INSTALLATION_ID];
    }
    // Generate new installation ID (anonymous, not linked to user identity)
    const newId = crypto.randomUUID();
    await chrome.storage.local.set({ [STORAGE_KEYS.INSTALLATION_ID]: newId });
    return newId;
  },

  // ── LICENSE ────────────────────────────────────────────────────────────

  async getLicense() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LICENSE);
    return result[STORAGE_KEYS.LICENSE] || null;
  },

  async setLicense(licenseData) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE]: licenseData });
  },

  async clearLicense() {
    await chrome.storage.local.remove(STORAGE_KEYS.LICENSE);
  },

  async getLicenseCache() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LICENSE_CACHE);
    return result[STORAGE_KEYS.LICENSE_CACHE] || null;
  },

  async setLicenseCache(cacheData) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE_CACHE]: cacheData });
  },

  // ── SETTINGS ──────────────────────────────────────────────────────────

  async getSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return {
      // Defaults
      geminiModel: 'gemini-2.0-flash',
      autoFillTitle: true,
      autoFillKeywords: true,
      skipExistingMetadata: true,
      batchDelay: 1500,
      maxBatchSize: 100,
      defaultPlatform: 'adobe',
      theme: 'dark',
      showProBadges: true,
      // Override with stored
      ...(result[STORAGE_KEYS.SETTINGS] || {}),
    };
  },

  async saveSettings(settings) {
    const current = await this.getSettings();
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { ...current, ...settings },
    });
  },

  // ── DAILY USAGE ──────────────────────────────────────────────────────

  async getDailyUsage() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DAILY_USAGE);
    const stored = result[STORAGE_KEYS.DAILY_USAGE] || {};
    const today = new Date().toDateString();

    // Reset if it's a new day
    if (stored.date !== today) {
      return { count: 0, date: today };
    }
    return stored;
  },

  async incrementDailyUsage() {
    const usage = await this.getDailyUsage();
    await chrome.storage.local.set({
      [STORAGE_KEYS.DAILY_USAGE]: {
        count: (usage.count || 0) + 1,
        date: new Date().toDateString(),
      },
    });
  },

  // ── METADATA HISTORY ──────────────────────────────────────────────────

  async getMetadataHistory(limit = 50) {
    const result = await chrome.storage.local.get(STORAGE_KEYS.METADATA_HISTORY);
    const history = result[STORAGE_KEYS.METADATA_HISTORY] || [];
    return history.slice(0, limit);
  },

  async addMetadataHistory(entry) {
    const history = await this.getMetadataHistory(99);
    const newEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      platform: entry.platform || 'adobe',
      title: entry.title,
      keywords: entry.keywords,
      imageThumb: entry.imageThumb || null,
      qualityScore: entry.qualityScore || null,
    };
    // Prepend (newest first), keep max 100
    const updated = [newEntry, ...history].slice(0, 100);
    await chrome.storage.local.set({ [STORAGE_KEYS.METADATA_HISTORY]: updated });
    return newEntry;
  },

  async clearMetadataHistory() {
    await chrome.storage.local.remove(STORAGE_KEYS.METADATA_HISTORY);
  },

  // ── PROMPT PROFILES ──────────────────────────────────────────────────

  async getPromptProfiles() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PROMPT_PROFILES);
    return result[STORAGE_KEYS.PROMPT_PROFILES] || [];
  },

  async savePromptProfile(profile) {
    const profiles = await this.getPromptProfiles();
    const existing = profiles.findIndex(p => p.id === profile.id);
    if (existing >= 0) {
      profiles[existing] = profile;
    } else {
      profiles.push({ ...profile, id: profile.id || crypto.randomUUID() });
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.PROMPT_PROFILES]: profiles });
  },

  async deletePromptProfile(profileId) {
    const profiles = await this.getPromptProfiles();
    const updated = profiles.filter(p => p.id !== profileId);
    await chrome.storage.local.set({ [STORAGE_KEYS.PROMPT_PROFILES]: updated });
  },

  // ── BATCH QUEUE ──────────────────────────────────────────────────────

  async getBatchQueue() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.BATCH_QUEUE);
    return result[STORAGE_KEYS.BATCH_QUEUE] || null;
  },

  async saveBatchQueue(queue) {
    await chrome.storage.local.set({ [STORAGE_KEYS.BATCH_QUEUE]: queue });
  },

  async clearBatchQueue() {
    await chrome.storage.local.remove(STORAGE_KEYS.BATCH_QUEUE);
  },

  // ── ONBOARDING ────────────────────────────────────────────────────────

  async isOnboardingDone() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ONBOARDING_DONE);
    return !!result[STORAGE_KEYS.ONBOARDING_DONE];
  },

  async markOnboardingDone() {
    await chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDING_DONE]: true });
  },

  // ── UTILITIES ────────────────────────────────────────────────────────

  async clearAll() {
    // WARNING: Clears all extension data. Only for dev/testing.
    await chrome.storage.local.clear();
  },

  async exportAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, resolve);
    });
  },
};

  // Make globally available
  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.StorageService = StorageService;
  root.STORAGE_KEYS = STORAGE_KEYS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StorageService, STORAGE_KEYS };
  }
})();
