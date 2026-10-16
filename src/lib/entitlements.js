/**
 * ENTITLEMENTS SERVICE
 * ====================
 * Centralized feature gating. ALL feature checks go through here.
 * Never scatter `if (isPro)` checks throughout the codebase.
 *
 * Usage:
 *   const ent = await EntitlementsService.get();
 *   if (ent.can('batchProcessing')) { ... }
 */

(function () {
  'use strict';

  const FEATURE_DEFINITIONS = {
  // ── FREE FEATURES ──────────────────────────────────────────────────────
  basicMetadata: {
    name: 'Basic Metadata Generation',
    description: 'Generate title and keywords for one image at a time.',
    plan: 'free',
  },
  platformDetection: {
    name: 'Platform Detection',
    description: 'Auto-detect Adobe Stock and Magnific contributor pages.',
    plan: 'free',
  },
  geminiIntegration: {
    name: 'Gemini AI Integration',
    description: 'Use Gemini AI tab for metadata generation.',
    plan: 'free',
  },

  // ── PRO FEATURES ──────────────────────────────────────────────────────
  advancedMetadata: {
    name: 'Advanced Metadata Generation',
    description: 'Enhanced prompts with priority keyword ordering and optimization.',
    plan: 'pro',
  },
  batchProcessing: {
    name: 'Batch Processing',
    description: 'Process all images in your upload grid automatically.',
    plan: 'pro',
  },
  metadataHistory: {
    name: 'Metadata History',
    description: 'Review and reuse previously generated metadata.',
    plan: 'pro',
  },
  promptProfiles: {
    name: 'Prompt Profiles',
    description: 'Save and reuse custom prompt templates.',
    plan: 'pro',
  },
  qualityChecker: {
    name: 'Quality Checker',
    description: 'Score metadata quality: title, keywords, relevance.',
    plan: 'pro',
  },
  advancedKeywordEngine: {
    name: 'Advanced Keyword Engine',
    description: 'Duplicate detection, relevance scoring, and ordering.',
    plan: 'pro',
  },
  csvExport: {
    name: 'CSV Export',
    description: 'Export metadata results as CSV.',
    plan: 'pro',
  },
  jsonExport: {
    name: 'JSON Export',
    description: 'Export metadata results as JSON.',
    plan: 'pro',
  },
  retryFailedItems: {
    name: 'Retry Failed Items',
    description: 'Re-queue and retry any items that failed during batch.',
    plan: 'pro',
  },
  savedWorkflows: {
    name: 'Saved Workflows',
    description: 'Save and restore workflow settings.',
    plan: 'pro',
  },
  priorityProcessing: {
    name: 'Priority Processing',
    description: 'Optimized prompt strategies for faster results.',
    plan: 'pro',
  },
};

const FREE_FEATURES = Object.entries(FEATURE_DEFINITIONS)
  .filter(([, def]) => def.plan === 'free')
  .map(([key]) => key);

const PRO_FEATURES = Object.keys(FEATURE_DEFINITIONS); // Pro gets everything

class EntitlementsServiceImpl {
  constructor() {
    this._license = null;
    this._initialized = false;

    // Auto-initialize from storage immediately
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get('asmp_license', (res) => {
        if (res && res.asmp_license) {
          this._license = res.asmp_license;
          this._initialized = true;
        }
      });

      // Keep license state synchronized in real-time across all tabs
      if (chrome.storage?.onChanged?.addListener) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local' && changes.asmp_license) {
            this._license = changes.asmp_license.newValue || null;
            this._initialized = true;
            console.log('[Entitlements] License updated in real-time:', this._license?.plan);
          }
        });
      }
    }
  }

  /**
   * Initialize by loading current license from storage.
   */
  async init() {
    if (this._initialized && this._license) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const res = await chrome.storage.local.get('asmp_license');
        this._license = res?.asmp_license || null;
      } else {
        const { StorageService } = await _require('storage');
        this._license = await StorageService.getLicense();
      }
    } catch (e) {
      console.warn('[Entitlements] Init error:', e);
    }
    this._initialized = true;
  }

  /**
   * Check if a feature is available for the current user.
   * @param {string} featureId
   * @returns {boolean}
   */
  can(featureId) {
    if (!FEATURE_DEFINITIONS[featureId]) {
      console.warn(`[Entitlements] Unknown feature: ${featureId}`);
      return false;
    }

    const featureDef = FEATURE_DEFINITIONS[featureId];

    // Free features always available
    if (featureDef.plan === 'free') return true;

    // Pro feature — check license
    return this._isProActive();
  }

  /**
   * Check if a feature exists and is Pro-only.
   * @param {string} featureId
   * @returns {boolean}
   */
  isProFeature(featureId) {
    const def = FEATURE_DEFINITIONS[featureId];
    return def ? def.plan === 'pro' : false;
  }

  /**
   * Get the current plan ID.
   * @returns {string} 'free' | 'pro' | 'lifetime'
   */
  getPlan() {
    if (!this._isProActive()) return 'free';
    return this._license?.plan || 'free';
  }

  /**
   * Check if the current license is an active Pro license.
   * @returns {boolean}
   */
  _isProActive() {
    if (!this._license) return false;
    if (this._license.status !== 'active') return false;

    // A free plan or unapproved plan must never grant Pro access
    const plan = (this._license.plan || '').toLowerCase().trim();
    const paidPlans = ['pro', 'pro_monthly', 'pro_3month', 'pro_yearly', 'lifetime'];
    if (!paidPlans.includes(plan)) return false;

    // Check expiration
    if (this._license.expiresAt) {
      const expiresAt = new Date(this._license.expiresAt);
      const now = new Date();
      if (now > expiresAt) return false;
    }

    // Check grace period for offline
    if (this._license.offlineMode) {
      const lastVerified = new Date(this._license.lastVerifiedAt || 0);
      const gracePeriodMs = (PRODUCT_CONFIG?.LICENSE?.OFFLINE_GRACE_PERIOD_DAYS || 7) * 24 * 60 * 60 * 1000;
      const now = new Date();
      if ((now - lastVerified) > gracePeriodMs) return false;
    }

    return true;
  }

  /**
   * Get all features available to the current user.
   * @returns {string[]}
   */
  getAvailableFeatures() {
    if (this._isProActive()) return PRO_FEATURES;
    return FREE_FEATURES;
  }

  /**
   * Get license status for display.
   * @returns {object}
   */
  getLicenseInfo() {
    if (!this._license || !this._isProActive()) {
      return {
        plan: 'FREE',
        status: 'inactive',
        isActive: false,
      };
    }

    return {
      plan: this._license.plan?.toUpperCase() || 'PRO',
      status: 'active',
      isActive: true,
      expiresAt: this._license.expiresAt,
      licenseId: this._license.licenseId,
      activatedDevices: this._license.activatedDevices || 1,
      activationLimit: this._license.activationLimit || 1,
      offlineMode: this._license.offlineMode || false,
      lastVerifiedAt: this._license.lastVerifiedAt,
    };
  }

  /**
   * Refresh entitlements from storage (call after license activation).
   */
  async refresh() {
    this._initialized = false;
    await this.init();
  }

  /**
   * Get daily generation count and limit.
   */
  async getDailyUsage() {
    const { StorageService } = await _require('storage');
    const usage = await StorageService.getDailyUsage();
    const limit = this._isProActive() ? -1 : (PRODUCT_CONFIG?.FREE_LIMITS?.DAILY_GENERATIONS || 20);
    return {
      used: usage.count || 0,
      limit,
      unlimited: limit === -1,
      remaining: limit === -1 ? Infinity : Math.max(0, limit - (usage.count || 0)),
    };
  }

  /**
   * Increment generation count for today.
   */
  async recordGeneration() {
    const { StorageService } = await _require('storage');
    await StorageService.incrementDailyUsage();
  }

  /**
   * Check if user can generate (hasn't hit daily limit).
   */
  async canGenerate() {
    if (this._isProActive()) return true;
    const usage = await this.getDailyUsage();
    return usage.remaining > 0;
  }
}

// Helper to lazy-load other modules (avoids circular deps)
async function _require(moduleName) {
  // In extension context, modules are loaded as scripts
  // Access via globalThis
  if (moduleName === 'storage' && globalThis.StorageService) {
    return { StorageService: globalThis.StorageService };
  }
  // Fallback stub for storage if not loaded
  return {
    StorageService: {
      getLicense: async () => null,
      getDailyUsage: async () => ({ count: 0, date: new Date().toDateString() }),
      incrementDailyUsage: async () => {},
    }
  };
}

// Singleton
const entitlementsService = new EntitlementsServiceImpl();

  // Export
  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.EntitlementsService = entitlementsService;
  root.FEATURE_DEFINITIONS = FEATURE_DEFINITIONS;
  root.FREE_FEATURES = FREE_FEATURES;
  root.PRO_FEATURES = PRO_FEATURES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EntitlementsService: entitlementsService, FEATURE_DEFINITIONS, FREE_FEATURES, PRO_FEATURES };
  }
})();
