// ═══════════════════════════════════════════════════════════════════════════
// Profile: display name (unique, live availability check) and photo
// (synced to the profiles table once migrated).
// ═══════════════════════════════════════════════════════════════════════════

// ─── PROFILE ──────────────────────────────────────────────────────────────────
let profilePhoto = localStorage.getItem('profile_photo') || null;
let profileName  = localStorage.getItem('profile_name')  || '';

function loadProfile() {
  const nameEl = document.getElementById('sidebar-name');
  if (nameEl) nameEl.textContent = profileName || 'Set your name';

  const imgEl  = document.getElementById('profile-avatar-img');
  const initEl = document.getElementById('profile-avatar-initials');
  if (!imgEl || !initEl) return;
  if (profilePhoto) {
    imgEl.src = profilePhoto; imgEl.style.display = 'block';
    initEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none'; initEl.style.display = '';
    const initials = profileName ? profileName.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
    initEl.textContent = initials;
  }
}

function openProfileModal_internal() {
  document.getElementById('profile-name-input').value = profileName || '';
  setNameStatus('');
  const emailEl = document.getElementById('profile-email-display');
  if (emailEl && currentUser) emailEl.textContent = currentUser.email || '—';
  const imgEl  = document.getElementById('profile-avatar-img');
  const initEl = document.getElementById('profile-avatar-initials');
  if (profilePhoto) {
    imgEl.src = profilePhoto; imgEl.style.display = 'block';
    initEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none'; initEl.style.display = '';
    initEl.textContent = profileName ? profileName.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';
  }
  document.getElementById('profile-modal').classList.add('open');
}

function handleProfilePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('Image must be under 5MB', 'err');

  const reader = new FileReader();
  reader.onload = (e) => {
    // Compress image to max 200x200 before storing in localStorage
    // This prevents hitting the 5-10MB localStorage quota
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 200;
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      profilePhoto = canvas.toDataURL('image/jpeg', 0.82);

      const imgEl  = document.getElementById('profile-avatar-img');
      const initEl = document.getElementById('profile-avatar-initials');
      if (imgEl) { imgEl.src = profilePhoto; imgEl.style.display = 'block'; }
      if (initEl) initEl.style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  if (demoGuard()) return;
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) return toast('Enter a display name', 'err');

  const btn = document.querySelector('#profile-modal [data-action="save-profile"]');
  const prevText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  try {
    // Skip the round-trip only if the name is byte-identical to what's already
    // saved (e.g. they just changed the photo). Any actual change — including
    // a case-only re-cast — goes through the upsert so casing stays correct
    // in Supabase too.
    // The photo is saved to the profile row too (once migrated), so every
    // device shows it — not just this browser.
    const photoChanged = (profilePhoto || null) !== (localStorage.getItem('profile_photo') || null);
    if (name !== profileName || (photoChanged && DB_READY)) {
      await sbUpsertProfile(name, photoChanged ? profilePhoto : undefined);
    }
    profileName = name;
    safeLocalSet('profile_name', profileName);
    if (profilePhoto) safeLocalSet('profile_photo', profilePhoto);
    loadProfile();
    closeModal('profile-modal');
    setNameStatus('');
    toast('Profile saved ✓');
  } catch (e) {
    if (e.message === 'TAKEN') {
      setNameStatus('✗ Already taken — try a different display name', 'red');
    } else {
      toast(e.message || 'Failed to save profile', 'err');
    }
  }

  if (btn) { btn.textContent = prevText; btn.disabled = false; }
}

// ─── DISPLAY NAME AVAILABILITY (live check as the user types) ────────────────
function setNameStatus(msg, color) {
  const el = document.getElementById('profile-name-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color === 'red' ? 'var(--red)' : color === 'green' ? 'var(--green)' : 'var(--muted)';
}

let nameCheckTimer = null;
let nameCheckToken = 0;
function onProfileNameInput(value) {
  const name = value.trim();
  clearTimeout(nameCheckTimer);

  if (!name) { setNameStatus(''); return; }
  if (name.toLowerCase() === (profileName || '').toLowerCase()) { setNameStatus(''); return; }
  if (name.length < 3) { setNameStatus('Minimum 3 characters', 'red'); return; }

  setNameStatus('Checking…');
  const myToken = ++nameCheckToken;

  nameCheckTimer = setTimeout(async () => {
    try {
      const available = await sbCheckNameAvailable(name);
      if (myToken !== nameCheckToken) return; // a newer keystroke superseded this check
      setNameStatus(available ? '✓ Available' : '✗ Already taken — try a different display name', available ? 'green' : 'red');
    } catch (e) {
      if (myToken !== nameCheckToken) return;
      setNameStatus('');
      log.warn('[onProfileNameInput] Availability check failed:', e.message);
    }
  }, 450);
}

