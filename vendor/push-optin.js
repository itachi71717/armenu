// Shared push-notification opt-in for kitchen + staff kiosks (and reusable
// anywhere else). Auto-injects a soft banner 6 seconds after page load if:
//   - service worker is supported
//   - notifications aren't already granted / denied
//   - we haven't already prompted this browser
//
// After grant: subscribes to /api/push/subscribe with the staff Bearer token
// found in localStorage (`armenu_staff_session` or `armenu_kitchen_session`).
// Silent no-op when the VAPID key isn't configured.
(function () {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  function getSessionToken() {
    for (const k of ['armenu_kitchen_session', 'armenu_staff_session']) {
      try {
        const s = JSON.parse(localStorage.getItem(k) || 'null');
        if (s?.token) return { token: s.token, role: k.includes('kitchen') ? 'kitchen' : 'waiter', label: s.staff?.name || s.restaurant?.name };
      } catch {}
    }
    return null;
  }
  function urlB64ToUint8Array(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function subscribe(sess) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const cfg = await fetch('/api/push/vapid-key').then(r => r.json());
      if (!cfg.publicKey) return;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(cfg.publicKey)
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + sess.token },
        body: JSON.stringify({ subscription: sub.toJSON(), role: sess.role, user_label: sess.label })
      });
    } catch (e) { console.warn('push subscribe failed:', e); }
  }

  function inject(sess) {
    if (document.getElementById('kioskPushBanner')) return;
    const w = document.createElement('div');
    w.id = 'kioskPushBanner';
    w.style.cssText = 'position:fixed;bottom:16px;right:16px;left:auto;max-width:380px;z-index:200;padding:14px 16px;border-radius:12px;background:rgba(18,16,11,.96);color:#f5efe6;border:1px solid rgba(232,197,138,.28);box-shadow:0 16px 40px rgba(0,0,0,.5);backdrop-filter:blur(12px);font-family:Inter,system-ui,sans-serif;font-size:13px;line-height:1.5;animation:kbPop .25s ease-out';
    if (!document.getElementById('kbPopKF')) {
      const s = document.createElement('style'); s.id = 'kbPopKF';
      s.textContent = '@keyframes kbPop{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}';
      document.head.appendChild(s);
    }
    w.innerHTML = ''
      + '<div style="font-weight:700;color:#e8c58a;margin-bottom:4px">Turn on order alerts?</div>'
      + '<div style="color:#a89d84;margin-bottom:10px">Hear a ping the moment a new order hits — even if this tab is hidden.</div>'
      + '<div style="display:flex;gap:6px">'
      + '<button data-kb="yes" style="flex:1;padding:8px;border-radius:8px;background:linear-gradient(135deg,#e8c58a,#d4a574);color:#0a0806;font-weight:700;font-size:12px;border:none;cursor:pointer">Turn on</button>'
      + '<button data-kb="no" style="padding:8px 12px;border-radius:8px;background:rgba(245,239,220,.06);color:#a89d84;font-size:12px;border:1px solid rgba(245,239,220,.1);cursor:pointer">Later</button>'
      + '</div>';
    document.body.appendChild(w);
    w.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-kb]');
      if (!b) return;
      try { localStorage.setItem('armenu_push_kiosk_prompted', '1'); } catch {}
      if (b.dataset.kb === 'yes') {
        w.remove();
        const perm = await Notification.requestPermission();
        if (perm === 'granted') await subscribe(sess);
      } else { w.remove(); }
    });
  }

  function tryPrompt() {
    const sess = getSessionToken();
    if (!sess) return;
    if (Notification.permission === 'granted') { subscribe(sess); return; }
    if (Notification.permission === 'denied') return;
    try { if (localStorage.getItem('armenu_push_kiosk_prompted') === '1') return; } catch {}
    setTimeout(() => inject(sess), 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryPrompt);
  else tryPrompt();
})();
