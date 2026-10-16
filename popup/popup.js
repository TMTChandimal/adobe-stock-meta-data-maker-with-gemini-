// popup/popup.js - Compact Popup Launcher

document.addEventListener('DOMContentLoaded', () => {
  const planBadge = document.getElementById('popup-plan-badge');
  const statusBadge = document.getElementById('popup-status-badge');
  const usageText = document.getElementById('popup-usage-text');
  const usageFill = document.getElementById('popup-usage-fill');
  const proCard = document.getElementById('popup-pro-card');
  const licenseForm = document.getElementById('popup-license-form');
  const toast = document.getElementById('popup-toast');

  let toastTimer = null;
  function showToast(message, type = 'info', duration = 4000) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `popup-toast ${type}`;
    toast.style.display = 'block';
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }

  function formatPlan(plan) {
    const map = {
      'pro_monthly': 'Pro Monthly',
      'pro_annual': 'Pro Annual',
      'pro_lifetime': 'Pro Lifetime'
    };
    return map[plan] || (plan ? plan.toUpperCase() : 'Pro Active');
  }

  // 1. Refresh Entitlements & Usage
  function refreshInfo() {
    chrome.runtime.sendMessage({ action: MessageActions.CHECK_ENTITLEMENTS }, (res) => {
      if (res?.success) {
        const info = res.info;
        const usage = res.usage;

        if (info.isActive) {
          const friendlyPlan = formatPlan(info.plan);
          planBadge.textContent = 'PRO ACTIVE';
          planBadge.style.color = '#10b981';
          usageText.textContent = `${usage.used} (Unlimited Pro)`;
          usageFill.style.width = '100%';

          if (proCard) {
            proCard.style.display = 'flex';
            document.getElementById('popup-pro-plan-name').textContent = friendlyPlan;
            document.getElementById('popup-pro-device-count').textContent = `${info.activatedDevices || 1} of ${info.activationLimit || 2} Devices`;
            document.getElementById('popup-pro-expiry').textContent = info.expiresAt
              ? `Renews ${new Date(info.expiresAt).toLocaleDateString()}`
              : 'Lifetime Access';
          }
          if (licenseForm) licenseForm.style.display = 'none';
        } else {
          planBadge.textContent = 'FREE PLAN';
          planBadge.style.color = '#60a5fa';
          usageText.textContent = `${usage.used} / ${usage.limit}`;
          const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
          usageFill.style.width = `${pct}%`;

          if (proCard) proCard.style.display = 'none';
          if (licenseForm) licenseForm.style.display = 'block';
        }
      }
    });

    chrome.runtime.sendMessage({ action: MessageActions.GET_STATE }, (res) => {
      if (res?.activeTask) {
        statusBadge.textContent = res.activeTask.status;
        if (['PENDING_GEMINI', 'APPLYING', 'QUEUED'].includes(res.activeTask.status)) {
          statusBadge.style.color = '#f59e0b';
          statusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
        }
      } else {
        statusBadge.textContent = 'Ready';
        statusBadge.style.color = '#10b981';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
      }
    });
  }

  // 2. Process Selected Button Click
  document.getElementById('popup-btn-process-selected')?.addEventListener('click', () => {
    chrome.tabs.query({ url: 'https://contributor.stock.adobe.com/*' }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        showToast('Please open Adobe Stock Contributor with an asset selected first.', 'error', 5000);
        return;
      }
      // Target verified active or frontmost Adobe tab, not arbitrary tabs[0]
      const targetTab = tabs.find(t => t.active) || tabs[0];
      chrome.tabs.sendMessage(targetTab.id, { action: 'TRIGGER_AUTO_METADATA' });
      statusBadge.textContent = 'Triggered';
      showToast('⚡ Sent generation command to Adobe Stock!', 'success', 3000);
      setTimeout(refreshInfo, 800);
    });
  });

  // 3. Open Full Workspace Button Click
  document.getElementById('popup-btn-workspace')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: MessageActions.OPEN_WORKSPACE });
    window.close();
  });

  // 4. Quick License Activation
  document.getElementById('popup-btn-activate')?.addEventListener('click', () => {
    const input = document.getElementById('popup-license-input');
    const code = (input.value || '').trim();
    if (!code) return showToast('Please enter a license code.', 'error', 3000);

    const btn = document.getElementById('popup-btn-activate');
    btn.disabled = true;
    btn.textContent = '...';

    chrome.runtime.sendMessage({ action: MessageActions.ACTIVATE_LICENSE, licenseCode: code }, (res) => {
      btn.disabled = false;
      btn.textContent = 'Activate';
      if (res?.success) {
        showToast('🎉 Pro license activated successfully!', 'success', 5000);
        input.value = '';
        refreshInfo();
      } else {
        showToast(`❌ ${res?.error || 'Activation Failed'}`, 'error', 5000);
      }
    });
  });

  refreshInfo();
});
