// ui/app.js - Central Workspace Controller
// Manages 5 coherent views, live worker state synchronization, review editor, and exports

document.addEventListener('DOMContentLoaded', async () => {
  let currentTask = null;
  let originalMetadata = { title: '', keywords: [] };
  let metadataHistory = [];

  // ── VIEW SWITCHING ────────────────────────────────────────────────────────

  const navItems = document.querySelectorAll('.nav-item');
  const viewPanels = document.querySelectorAll('.view-panel');

  function switchView(viewName) {
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
    viewPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `view-${viewName}`);
    });

    if (viewName === 'overview') refreshOverview();
    if (viewName === 'history') refreshHistory();
    if (viewName === 'settings') refreshLicenseAndSettings();
    if (viewName === 'batch') refreshBatchQueue();
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  document.getElementById('ov-btn-upgrade')?.addEventListener('click', () => switchView('settings'));

  // ── FIRST-USE CONSENT MODAL ───────────────────────────────────────────────

  async function checkConsent() {
    chrome.runtime.sendMessage({ action: MessageActions.GET_CONSENT_STATUS }, (res) => {
      if (!res?.consent) {
        document.getElementById('consent-modal').style.display = 'flex';
      }
    });
  }

  document.getElementById('consent-btn-accept')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: MessageActions.SET_CONSENT_STATUS }, () => {
      document.getElementById('consent-modal').style.display = 'none';
    });
  });

  function formatPlanName(plan) {
    const map = {
      'pro_monthly': 'Pro Monthly',
      'pro_annual': 'Pro Annual',
      'pro_lifetime': 'Pro Lifetime'
    };
    return map[plan] || (plan ? plan.toUpperCase() : 'Free Plan');
  }

  // ── OVERVIEW VIEW ─────────────────────────────────────────────────────────

  async function refreshOverview() {
    chrome.runtime.sendMessage({ action: MessageActions.CHECK_ENTITLEMENTS }, (res) => {
      if (res?.success) {
        const info = res.info;
        const usage = res.usage;

        const planText = info.isActive ? `${formatPlanName(info.plan)} (ACTIVE)` : 'FREE PLAN';
        document.getElementById('sidebar-plan-tag').textContent = planText;
        document.getElementById('ov-plan-name').textContent = planText;

        if (usage.unlimited) {
          document.getElementById('ov-quota-caption').textContent = `${usage.used} generations used today (Unlimited Pro)`;
          document.getElementById('ov-quota-fill').style.width = '100%';
        } else {
          const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
          document.getElementById('ov-quota-caption').textContent = `${usage.used} / ${usage.limit} daily generations used`;
          document.getElementById('ov-quota-fill').style.width = `${pct}%`;
        }
      }
    });

    // Check tabs
    chrome.tabs.query({ url: 'https://contributor.stock.adobe.com/*' }, (tabs) => {
      const el = document.getElementById('ov-status-adobe');
      if (tabs.length > 0) {
        el.textContent = 'Connected';
        el.className = 'badge';
        el.style.color = '#10b981';
      } else {
        el.textContent = 'Not Open';
        el.className = 'badge';
        el.style.color = '#ef4444';
      }
    });

    chrome.tabs.query({ url: 'https://gemini.google.com/*' }, (tabs) => {
      const el = document.getElementById('ov-status-gemini');
      if (tabs.length > 0) {
        el.textContent = 'Connected';
        el.className = 'badge';
        el.style.color = '#10b981';
      } else {
        el.textContent = 'Not Open';
        el.className = 'badge';
        el.style.color = '#ef4444';
      }
    });
  }

  // ── GENERATE & REVIEW VIEW ────────────────────────────────────────────────

  function updateReviewState(task) {
    currentTask = task;
    if (!task) {
      document.getElementById('gr-task-status').textContent = 'IDLE';
      document.getElementById('gr-asset-id').textContent = 'None';
      document.getElementById('gr-btn-generate').style.display = 'inline-flex';
      document.getElementById('gr-btn-cancel').style.display = 'none';
      return;
    }

    document.getElementById('gr-task-status').textContent = task.status;
    document.getElementById('gr-asset-id').textContent = task.assetId || 'Unknown';

    const isRunning = ['QUEUED', 'PENDING_GEMINI', 'APPLYING'].includes(task.status);
    document.getElementById('gr-btn-generate').style.display = isRunning ? 'none' : 'inline-flex';
    document.getElementById('gr-btn-cancel').style.display = isRunning ? 'inline-flex' : 'none';

    if (task.metadata) {
      if (task.metadata.title && !document.getElementById('gr-input-title').value) {
        document.getElementById('gr-input-title').value = task.metadata.title;
      }
      if (task.metadata.keywords && task.metadata.keywords.length > 0 && !document.getElementById('gr-input-keywords').value) {
        document.getElementById('gr-input-keywords').value = task.metadata.keywords.join(', ');
      }
      if (task.metadata.originalTitle || task.metadata.originalKeywords?.length > 0) {
        originalMetadata = {
          title: task.metadata.originalTitle || '',
          keywords: task.metadata.originalKeywords || []
        };
        document.getElementById('gr-btn-undo').disabled = false;
      }
    }

    const hasContent = document.getElementById('gr-input-title').value.length > 0;
    document.getElementById('gr-btn-apply').disabled = !hasContent || isRunning;

    updateCounts();
  }

  function updateCounts() {
    const titleVal = document.getElementById('gr-input-title').value;
    document.getElementById('gr-title-count').textContent = `${titleVal.length} / 200`;

    const kwVal = document.getElementById('gr-input-keywords').value;
    const kwArr = kwVal.split(/[,;\n]+/).map(k => k.trim()).filter(Boolean);
    document.getElementById('gr-keyword-count').textContent = `${kwArr.length} keywords`;
  }

  document.getElementById('gr-input-title').addEventListener('input', updateCounts);
  document.getElementById('gr-input-keywords').addEventListener('input', updateCounts);

  // Generate button click
  document.getElementById('gr-btn-generate').addEventListener('click', () => {
    chrome.tabs.query({ url: 'https://contributor.stock.adobe.com/*' }, (adobeTabs) => {
      const targetTab = (adobeTabs || []).find(t => t.active) || (adobeTabs && adobeTabs[0]);
      if (!targetTab) {
        alert('Please open an Adobe Stock Contributor tab with an uploaded asset first.');
        return;
      }
      chrome.tabs.sendMessage(targetTab.id, { action: 'TRIGGER_AUTO_METADATA' });
    });
  });

  // Cancel button click
  document.getElementById('gr-btn-cancel').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: MessageActions.CANCEL_TASK, taskId: currentTask?.taskId });
  });

  // Worker-mediated manual Apply to Adobe Stock click
  document.getElementById('gr-btn-apply').addEventListener('click', () => {
    if (!currentTask) {
      alert('No active metadata task available to apply.');
      return;
    }
    const title = document.getElementById('gr-input-title').value.trim();
    const keywords = document.getElementById('gr-input-keywords').value.split(/[,;\n]+/).map(k => k.trim()).filter(Boolean);

    chrome.runtime.sendMessage({
      action: MessageActions.RESUME_TASK,
      taskId: currentTask.taskId,
      metadata: { title, keywords }
    }, (res) => {
      if (res?.success) {
        document.getElementById('gr-task-status').textContent = 'APPLYING';
      } else {
        alert(`Apply failed: ${res?.error || 'Unknown error'}`);
      }
    });
  });

  // Undo click
  document.getElementById('gr-btn-undo').addEventListener('click', () => {
    document.getElementById('gr-input-title').value = originalMetadata.title;
    document.getElementById('gr-input-keywords').value = originalMetadata.keywords.join(', ');
    updateCounts();
  });

  // ── BATCH QUEUE VIEW ──────────────────────────────────────────────────────

  let batchItems = [];
  let isBatchRunning = false;

  function refreshBatchQueue() {
    // 1. Check entitlements
    chrome.runtime.sendMessage({ action: MessageActions.CHECK_ENTITLEMENTS }, (res) => {
      const isPro = res?.info?.isActive;
      const banner = document.getElementById('bq-pro-banner');
      const startBtn = document.getElementById('bq-btn-start');

      if (banner) {
        if (!isPro) {
          banner.style.display = 'block';
          banner.style.background = 'rgba(239, 68, 68, 0.1)';
          banner.style.color = '#f87171';
          banner.style.border = '1px solid rgba(239, 68, 68, 0.2)';
          banner.innerHTML = '🔒 <strong>Pro Feature:</strong> Batch Queue requires an active Pro license. <a href="#" id="bq-link-upgrade" style="color: #60a5fa; text-decoration: underline;">Activate License</a> to unlock batch processing.';
          document.getElementById('bq-link-upgrade')?.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('settings');
          });
          if (startBtn) {
            startBtn.disabled = true;
            startBtn.title = 'Requires Pro license';
          }
        } else {
          banner.style.display = 'block';
          banner.style.background = 'rgba(16, 185, 129, 0.1)';
          banner.style.color = '#34d399';
          banner.style.border = '1px solid rgba(16, 185, 129, 0.2)';
          banner.innerHTML = `✨ <strong>Pro Unlocked:</strong> Batch processing is active on your <strong>${escapeHtml(res?.info?.plan || 'Pro')}</strong> plan. Select multiple assets on Adobe Stock or click Start Batch to process all.`;
          if (startBtn && !isBatchRunning) {
            startBtn.disabled = false;
            startBtn.title = 'Start sequential batch processing';
          }
        }
      }
    });

    // 2. Query task manager and active tabs
    chrome.runtime.sendMessage({ action: MessageActions.GET_STATE }, (res) => {
      const tbody = document.getElementById('bq-table-body');
      if (!tbody) return;

      if (batchItems.length > 0) {
        renderBatchTable(batchItems);
        return;
      }

      if (!res?.queueSummary || res.queueSummary.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #64748b;">No items currently queued. Click <strong>Start Batch</strong> to begin processing uploaded images on Adobe Stock.</td></tr>';
        return;
      }

      tbody.innerHTML = res.queueSummary.map(item => `
        <tr>
          <td style="font-family: monospace;">${escapeHtml(item.assetId)}</td>
          <td><span class="badge">${escapeHtml(item.status)}</span></td>
          <td style="color: #94a3b8;">${escapeHtml(item.title || '—')}</td>
          <td><button class="btn btn-secondary btn-sm btn-remove-task" data-task-id="${escapeHtml(item.taskId)}">Remove</button></td>
        </tr>
      `).join('');
    });
  }

  function renderBatchTable(items) {
    const tbody = document.getElementById('bq-table-body');
    if (!tbody) return;
    if (!items || items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #64748b;">No items currently queued.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(item => {
      let badgeColor = '#64748b';
      if (item.status === 'APPLIED') badgeColor = '#10b981';
      else if (item.status === 'GENERATING' || item.status === 'SELECTING') badgeColor = '#f59e0b';
      else if (item.status === 'SKIPPED') badgeColor = '#60a5fa';
      else if (item.status === 'FAILED') badgeColor = '#ef4444';

      return `
        <tr>
          <td style="font-family: monospace;">${escapeHtml(item.assetId)}</td>
          <td><span class="badge" style="color: ${badgeColor}; border-color: ${badgeColor};">${escapeHtml(item.status)}</span></td>
          <td style="color: #94a3b8;">${escapeHtml(item.title || (item.error ? 'Error: ' + item.error : '—'))}</td>
          <td><button class="btn btn-secondary btn-sm btn-remove-task" data-task-id="${escapeHtml(item.assetId || '')}">Remove</button></td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('bq-table-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-task');
    if (btn) {
      const taskId = btn.dataset.taskId;
      batchItems = batchItems.filter(item => item.assetId !== taskId);
      chrome.runtime.sendMessage({ action: MessageActions.CANCEL_TASK, taskId });
      refreshBatchQueue();
    }
  });

  document.getElementById('bq-btn-clear')?.addEventListener('click', () => {
    batchItems = [];
    chrome.runtime.sendMessage({ action: MessageActions.CANCEL_TASK }, () => refreshBatchQueue());
  });

  document.getElementById('bq-btn-start')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: MessageActions.CHECK_ENTITLEMENTS }, (res) => {
      if (!res?.info?.isActive) {
        alert('🔒 Batch processing requires an active Pro license. Please activate your key in License & Settings.');
        switchView('settings');
        return;
      }

      chrome.tabs.query({ url: 'https://contributor.stock.adobe.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) {
          alert('Please open Adobe Stock Contributor (https://contributor.stock.adobe.com/uploads) with uploaded images first.');
          return;
        }

        const delay = parseInt(document.getElementById('bq-delay')?.value || '1500', 10);
        const skipExisting = document.getElementById('bq-skip-existing')?.checked !== false;

        const targetTab = tabs.find(t => t.active) || tabs[0];
        chrome.tabs.sendMessage(targetTab.id, {
          action: 'TRIGGER_BATCH_METADATA',
          options: { delay, skipExisting }
        }, (response) => {
          if (chrome.runtime.lastError || response?.success === false) {
            const err = chrome.runtime.lastError?.message || response?.reason || 'Failed to start batch on Adobe Stock.';
            alert(`⚠️ ${err}`);
          } else {
            isBatchRunning = true;
            document.getElementById('bq-btn-start').style.display = 'none';
            document.getElementById('bq-btn-stop').style.display = 'inline-flex';
          }
        });
      });
    });
  });

  document.getElementById('bq-btn-stop')?.addEventListener('click', () => {
    chrome.tabs.query({ url: 'https://contributor.stock.adobe.com/*' }, (tabs) => {
      tabs.forEach(t => {
        chrome.tabs.sendMessage(t.id, { action: 'STOP_BATCH_METADATA' }).catch(() => {});
      });
    });
    chrome.runtime.sendMessage({ action: MessageActions.CANCEL_TASK });
    isBatchRunning = false;
    document.getElementById('bq-btn-start').style.display = 'inline-flex';
    document.getElementById('bq-btn-stop').style.display = 'none';
  });

  // ── HISTORY & EXPORT VIEW ─────────────────────────────────────────────────

  async function refreshHistory() {
    chrome.storage.local.get('asmp_metadata_history', (res) => {
      metadataHistory = res?.asmp_metadata_history || [];
      const tbody = document.getElementById('hist-table-body');
      if (metadataHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #64748b;">No metadata history records.</td></tr>';
        return;
      }

      tbody.innerHTML = metadataHistory.slice(0, 30).map(item => `
        <tr>
          <td style="color: #94a3b8; font-size: 0.8rem;">${new Date(item.timestamp).toLocaleString()}</td>
          <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(item.assetId || 'asset')}</td>
          <td style="font-weight: 500;">${escapeHtml(item.title)}</td>
          <td style="font-size: 0.8rem; color: #94a3b8;">${Array.isArray(item.keywords) ? item.keywords.length : 0} tags</td>
        </tr>
      `).join('');
    });
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.getElementById('exp-btn-csv-generic')?.addEventListener('click', () => {
    if (metadataHistory.length === 0) return alert('No history items to export.');
    const csv = generateGenericCSV(metadataHistory);
    downloadFile(csv, 'adobe_stock_metadata_generic.csv', 'text/csv;charset=utf-8;');
  });

  document.getElementById('exp-btn-csv-adobe')?.addEventListener('click', () => {
    if (metadataHistory.length === 0) return alert('No history items to export.');
    const csv = generateAdobeStockImportCSV(metadataHistory);
    downloadFile(csv, 'adobe_stock_import.csv', 'text/csv;charset=utf-8;');
  });

  document.getElementById('exp-btn-json')?.addEventListener('click', () => {
    if (metadataHistory.length === 0) return alert('No history items to export.');
    const json = generateJSONExport(metadataHistory);
    downloadFile(json, 'adobe_stock_metadata.json', 'application/json;charset=utf-8;');
  });

  document.getElementById('exp-btn-clear')?.addEventListener('click', () => {
    if (confirm('Clear all metadata history?')) {
      chrome.storage.local.remove('asmp_metadata_history', () => refreshHistory());
    }
  });

  // ── LICENSE & SETTINGS VIEW ───────────────────────────────────────────────

  async function refreshLicenseAndSettings() {
    chrome.runtime.sendMessage({ action: MessageActions.CHECK_ENTITLEMENTS }, (res) => {
      if (res?.info) {
        const info = res.info;
        const box = document.getElementById('lic-info-box');
        if (info.isActive) {
          box.style.display = 'block';
          document.getElementById('lic-val-plan').textContent = formatPlanName(info.plan);
          document.getElementById('lic-val-devices').textContent = `${info.activatedDevices} / ${info.activationLimit}`;
          document.getElementById('lic-val-expires').textContent = info.expiresAt ? new Date(info.expiresAt).toLocaleDateString() : 'Lifetime (No Expiry)';
          document.getElementById('lic-val-lease').textContent = info.offlineMode ? 'Active (Offline Grace)' : 'Active (Online)';
          document.getElementById('lic-btn-deactivate').style.display = 'inline-flex';
        } else {
          box.style.display = 'none';
          document.getElementById('lic-btn-deactivate').style.display = 'none';
        }
      }
    });

    // Populate payment info from configuration
    if (typeof PRODUCT_CONFIG !== 'undefined') {
      document.getElementById('pay-paypal-email').textContent = PRODUCT_CONFIG.PAYPAL?.RECEIVE_EMAIL || 'support@yourdomain.com';
      const btcAddr = PRODUCT_CONFIG.BITCOIN?.ADDRESS;
      document.getElementById('pay-btc-address').textContent = (btcAddr && btcAddr !== 'YOUR_BITCOIN_ADDRESS_HERE') ? btcAddr : 'Available upon request (contact support)';
    }

    // Load automation preferences
    chrome.storage.local.get('asmp_settings', (res) => {
      const s = res?.asmp_settings || {};
      document.getElementById('pref-autofill-title').checked = s.autoFillTitle !== false;
      document.getElementById('pref-autofill-keywords').checked = s.autoFillKeywords !== false;
      document.getElementById('pref-custom-prompt').value = s.customPrompt || '';
    });
  }

  document.getElementById('lic-btn-activate')?.addEventListener('click', () => {
    const code = document.getElementById('lic-input-code').value.trim();
    if (!code) return alert('Please enter a license key.');

    const btn = document.getElementById('lic-btn-activate');
    btn.disabled = true;
    btn.textContent = 'Activating...';

    chrome.runtime.sendMessage({ action: MessageActions.ACTIVATE_LICENSE, licenseCode: code }, (res) => {
      btn.disabled = false;
      btn.textContent = 'Activate License';
      if (res?.success) {
        alert('🎉 License activated successfully!');
        refreshLicenseAndSettings();
        refreshOverview();
      } else {
        alert(`❌ Activation Failed: ${res?.error || 'Unknown error'}`);
      }
    });
  });

  document.getElementById('lic-btn-deactivate')?.addEventListener('click', () => {
    if (!confirm('Deactivate license on this device to free up your device slot?')) return;
    chrome.runtime.sendMessage({ action: MessageActions.DEACTIVATE_LICENSE }, (res) => {
      if (res?.success) {
        alert('License deactivated on this device.');
        refreshLicenseAndSettings();
        refreshOverview();
      } else {
        alert(`Error: ${res?.error || 'Failed to deactivate'}`);
      }
    });
  });

  document.getElementById('pay-btn-copy-btc')?.addEventListener('click', () => {
    const addr = document.getElementById('pay-btc-address').textContent;
    navigator.clipboard.writeText(addr);
    alert('Bitcoin address copied to clipboard!');
  });

  document.getElementById('pref-btn-save')?.addEventListener('click', () => {
    const s = {
      autoFillTitle: document.getElementById('pref-autofill-title').checked,
      autoFillKeywords: document.getElementById('pref-autofill-keywords').checked,
      customPrompt: document.getElementById('pref-custom-prompt').value.trim() || null
    };
    chrome.storage.local.set({ asmp_settings: s }, () => {
      alert('Preferences saved.');
    });
  });

  // ── LIVE WORKER STATE BROADCAST LISTENER ──────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === MessageActions.TASK_STATUS_UPDATE) {
      updateReviewState(message.task);
      refreshBatchQueue();
    }
    if (message.action === 'BATCH_STATUS_UPDATE') {
      if (message.isRunning !== undefined) {
        isBatchRunning = message.isRunning;
        const startBtn = document.getElementById('bq-btn-start');
        const stopBtn = document.getElementById('bq-btn-stop');
        if (startBtn && stopBtn) {
          startBtn.style.display = isBatchRunning ? 'none' : 'inline-flex';
          stopBtn.style.display = isBatchRunning ? 'inline-flex' : 'none';
        }
      }
      if (message.cards) {
        batchItems = message.cards;
        renderBatchTable(batchItems);
      } else if (message.activeAssetId) {
        const existing = batchItems.find(b => b.assetId === message.activeAssetId);
        if (existing) {
          existing.status = message.activeStatus;
          if (message.title) existing.title = message.title;
          if (message.error) existing.error = message.error;
        } else {
          batchItems.push({
            assetId: message.activeAssetId,
            status: message.activeStatus,
            title: message.title || '',
            error: message.error || ''
          });
        }
        renderBatchTable(batchItems);
      }
    }
  });

  // Initial State Query
  chrome.runtime.sendMessage({ action: MessageActions.GET_STATE }, (res) => {
    if (res?.activeTask) {
      updateReviewState(res.activeTask);
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Run initialization
  await checkConsent();
  refreshOverview();
});
