/**
 * PRODUCT CONFIGURATION
 * =====================
 * Centralized configuration for Adobe Stock Metadata Pro.
 * Change values here — they propagate everywhere in the extension.
 *
 * TO CHANGE THE PRODUCT NAME: Edit PRODUCT_NAME below.
 * TO CHANGE PRICES: Edit PLANS below.
 * TO CHANGE PAYMENT INFO: Edit PAYMENT section below.
 */

(function () {
  'use strict';

  const PRODUCT_CONFIG = {

  // ─── PRODUCT IDENTITY ────────────────────────────────────────────────────
  PRODUCT_NAME:       'Adobe Stock Metadata Pro',
  PRODUCT_SHORT:      'ASMP',
  PRODUCT_TAGLINE:    'Save time creating and managing stock metadata.',
  PRODUCT_VERSION:    '2.0.0',
  PRODUCT_ID:         'adobe-stock-metadata-pro',

  // ─── SELLER / SUPPORT ────────────────────────────────────────────────────
  SELLER_NAME:        'Your Name / Brand',
  SUPPORT_EMAIL:      'support@yourdomain.com',
  SUPPORT_TELEGRAM:   '@yourtelegram',
  SUPPORT_DISCORD:    'discord.gg/yourinvite',

  // ─── LEGAL LINKS (GitHub Pages) ──────────────────────────────────────────
  PRIVACY_URL:        'https://yourusername.github.io/your-repo/docs/privacy-policy.html',
  TERMS_URL:          'https://yourusername.github.io/your-repo/docs/terms.html',
  REFUND_POLICY_URL:  'https://yourusername.github.io/your-repo/docs/refund-policy.html',
  REFUND_POLICY_TEXT: '30-day refund policy. Contact support within 30 days of purchase.',

  // ─── PLANS & PRICING ─────────────────────────────────────────────────────
  PLANS: {
    FREE: {
      id:           'free',
      name:         'Free',
      price:        0,
      currency:     'USD',
      durationDays: null,  // no expiry
      features: [
        'basicMetadata',
        'platformDetection',
        'geminiIntegration',
      ],
      limits: {
        dailyGenerations: 20,
        batchSize:        0,    // 0 = disabled
      },
    },
    PRO_MONTHLY: {
      id:           'pro_monthly',
      name:         'Pro Monthly',
      price:        9.99,
      currency:     'USD',
      durationDays: 30,
      displayPrice: '$9.99 / month',
      features: [
        'basicMetadata',
        'platformDetection',
        'geminiIntegration',
        'advancedMetadata',
        'batchProcessing',
        'metadataHistory',
        'promptProfiles',
        'qualityChecker',
        'advancedKeywordEngine',
        'csvExport',
        'jsonExport',
        'retryFailedItems',
        'savedWorkflows',
        'priorityProcessing',
      ],
      limits: {
        dailyGenerations: -1,   // -1 = unlimited
        batchSize:        500,
      },
    },
    PRO_3MONTH: {
      id:           'pro_3month',
      name:         'Pro 3 Month',
      price:        24.99,
      currency:     'USD',
      durationDays: 90,
      displayPrice: '$24.99 / 3 months',
      features: 'same_as_pro_monthly',
      limits:   'same_as_pro_monthly',
    },
    PRO_YEARLY: {
      id:           'pro_yearly',
      name:         'Pro Yearly',
      price:        79.00,
      currency:     'USD',
      durationDays: 365,
      displayPrice: '$79.00 / year',
      features: 'same_as_pro_monthly',
      limits:   'same_as_pro_monthly',
    },
    LIFETIME: {
      id:           'lifetime',
      name:         'Lifetime',
      price:        199.00,
      currency:     'USD',
      durationDays: null,   // no expiry
      displayPrice: '$199.00 one-time',
      features: 'same_as_pro_monthly',
      limits:   'same_as_pro_monthly',
    },
  },

  // ─── PAYPAL PAYMENT ───────────────────────────────────────────────────────
  PAYPAL: {
    DISPLAY_NAME:    'PayPal',
    RECEIVE_EMAIL:   'your-paypal@yourdomain.com',
    PAYMENT_NOTE:    `Adobe Stock Metadata Pro License`,
    INSTRUCTIONS:    `Send payment to the PayPal email above.\nIn the payment note, write: "ASMP Pro License"\nAfter payment, send your PayPal Transaction ID to support.`,
    PAYPAL_URL:      'https://www.paypal.com/paypalme/yourpaypalme',
  },

  // ─── BITCOIN PAYMENT ─────────────────────────────────────────────────────
  BITCOIN: {
    DISPLAY_NAME:    'Bitcoin',
    ADDRESS:         'YOUR_BITCOIN_ADDRESS_HERE',
    NETWORK:         'Bitcoin (BTC) Mainnet',
    INSTRUCTIONS:    `Send BTC to the address above.\nAfter payment, send your Bitcoin Transaction ID (TXID) to support.`,
  },

  // ─── LICENSE SYSTEM ──────────────────────────────────────────────────────
  LICENSE: {
    // Public key for signature verification (Ed25519 public key in base64)
    // PRIVATE KEY IS NEVER HERE — only the public key
    PUBLIC_KEY_BASE64: 'h1YOzrW4J+0ZhLp/MeEAlb5EbWYqEBxjrgKmTCfX4dc=',

    // Backend API URL for license activation/validation
    API_URL: 'https://ttrrilnouedeifqjttai.supabase.co/functions/v1',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0cnJpbG5vdWVkZWlmcWp0dGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNzc0OTUsImV4cCI6MjEwNjk1MzQ5NX0.0AOGAsRw3m-uK0S97zQZADZgCYPMae0X9qoqQrYlEh0',

    // Grace period: if server is unreachable, allow Pro for this many days
    // after last successful online verification
    OFFLINE_GRACE_PERIOD_DAYS: 7,

    // How often to re-verify license with server (in hours)
    HEARTBEAT_INTERVAL_HOURS: 24,

    // License code prefix
    CODE_PREFIX: 'ASMP',
  },

  // ─── FREE PLAN LIMITS ─────────────────────────────────────────────────────
  FREE_LIMITS: {
    DAILY_GENERATIONS: 20,
    BATCH_SIZE:        0,    // batch disabled on free
  },

  // ─── FEATURE FLAGS ────────────────────────────────────────────────────────
  // Features that are always on regardless of plan
  ALWAYS_ON_FEATURES: [
    'basicMetadata',
    'platformDetection',
    'geminiIntegration',
  ],

};

  // Make available globally in extension context
  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.PRODUCT_CONFIG = PRODUCT_CONFIG;

  // Export for Node.js (license-admin tool)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PRODUCT_CONFIG };
  }
})();
