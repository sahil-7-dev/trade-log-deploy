// ═══════════════════════════════════════════════════════════════════════════
// Forgot password: send the reset email, handle the link back, set the
// new password.
// ═══════════════════════════════════════════════════════════════════════════

// ─── FORGOT PASSWORD ─────────────────────────────────────────────────────────
// Supabase emails a link back to this page with a one-time recovery session
// in the URL; we catch it on load and ask for the new password.
async function sendPasswordReset() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) return setAuthMsg('Enter your email above first, then click "Forgot password?"', 'red');
  setAuthMsg('Sending reset link…', 'muted');
  try {
    const redirect = encodeURIComponent(location.origin + location.pathname);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${redirect}`, {
      method: 'POST', headers: SB_HEADERS, body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.msg || data.error_description || data.message || `Request failed (${res.status})`);
    }
    setAuthMsg('If that email has an account, a reset link is on its way. Check your inbox (and spam).', 'green');
  } catch (e) {
    setAuthMsg(e.message === 'Failed to fetch' ? 'Network error — try again.' : e.message, 'red');
  }
}

let recoverySession = null;
function handlePasswordResetRedirect() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('error_description')) {
    history.replaceState(null, '', location.pathname + location.search);
    showAuthScreen();
    setAuthMsg(`Reset link problem: ${params.get('error_description')}. Request a new one.`, 'red');
    return true;
  }
  if (params.get('type') !== 'recovery' || !params.get('access_token')) return false;
  recoverySession = {
    access_token: params.get('access_token'), refresh_token: params.get('refresh_token'),
    expires_in: parseInt(params.get('expires_in') || '3600', 10),
  };
  history.replaceState(null, '', location.pathname + location.search); // tokens out of the address bar
  document.getElementById('auth-signin-panel').style.display = 'none';
  document.getElementById('auth-reset-panel').style.display = 'flex';
  showAuthScreen();
  return true;
}

async function submitNewPassword() {
  const p1 = document.getElementById('auth-new-pass').value;
  const p2 = document.getElementById('auth-new-pass2').value;
  const msg = (text, color) => { const el = document.getElementById('auth-reset-msg'); el.textContent = text; el.style.color = color === 'red' ? 'var(--red)' : 'var(--muted)'; };
  if (p1.length < 6) return msg('Use at least 6 characters', 'red');
  if (p1 !== p2) return msg('The two passwords don\'t match', 'red');
  if (!recoverySession) return msg('This reset link has expired — request a new one', 'red');
  msg('Saving…');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { ...SB_HEADERS, Authorization: `Bearer ${recoverySession.access_token}` },
      body: JSON.stringify({ password: p1 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.error_description || data.message || `Failed (${res.status})`);
    applySession({ ...recoverySession, user: data });
    recoverySession = null;
    restoreAccountStateFromCache(currentUser.id);
    document.getElementById('auth-reset-panel').style.display = 'none';
    document.getElementById('auth-signin-panel').style.display = 'flex';
    document.getElementById('user-email').textContent = currentUser.email;
    showAppShell();
    loadProfile();
    toast('Password updated — you\'re signed in ✓');
    await loadAllData();
  } catch (e) {
    msg(e.message, 'red');
  }
}

ACTIONS['forgot-password'] = () => sendPasswordReset();
ACTIONS['submit-new-password'] = () => submitNewPassword();
document.addEventListener('keydown', e => {
  if (e.target.id === 'auth-new-pass2' && e.key === 'Enter') submitNewPassword();
});
