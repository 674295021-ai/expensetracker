// Google OAuth & Session Management (Skill 05 API, Skill 09 OWASP)
// PRODUCTION ONLY — Real Google Identity Services (GSI) exclusively.

const Auth = {
  currentUser: null,
  googleClientId: null,

  async init() {
    // 1. Restore existing session if token exists in localStorage
    const token = API.getToken();
    const storedUser = localStorage.getItem('auth_user');

    if (token && storedUser) {
      try {
        this.currentUser = JSON.parse(storedUser);
        this.verifyMe(); // async: re-validates token with backend in background
      } catch (e) {
        this.logout();
      }
    }

    // 2. Fetch public configuration (Google Client ID from backend env)
    try {
      const configRes = await API.get('/api/auth/config');
      if (configRes && configRes.data) {
        this.googleClientId = configRes.data.googleClientId;
      }
    } catch (e) {
      console.warn('Config fetch error, continuing setup:', e);
    }

    // 3. Setup Google Identity Services sign-in button
    this.setupGoogleIdentity(this.googleClientId);

    // 4. Listen for token expiration dispatched by api.js
    window.addEventListener('auth:expired', () => {
      this.currentUser = null;
      this.renderAuthState();
    });

    this.renderAuthState();
  },

  async verifyMe() {
    try {
      const res = await API.get('/api/auth/me');
      if (res && res.data) {
        this.currentUser = res.data;
        localStorage.setItem('auth_user', JSON.stringify(res.data));
        this.renderAuthState();
      }
    } catch (err) {
      console.warn('Session verification failed, logging out:', err);
      this.logout();
    }
  },

  /**
   * Initialise Google Identity Services and render the official sign-in button.
   * If the Client ID is missing or invalid, renders a clear configuration message.
   * @param {string|null} clientId
   */
  setupGoogleIdentity(clientId) {
    const btnContainer = document.getElementById('google-signin-btn');
    if (!btnContainer) return;

    const isValidClientId = clientId &&
      !clientId.includes('YOUR_GOOGLE_CLIENT_ID') &&
      clientId.endsWith('.apps.googleusercontent.com');

    if (isValidClientId && window.google && window.google.accounts && window.google.accounts.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => this.handleGoogleCredentialResponse(response),
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        btnContainer.innerHTML = '';
        window.google.accounts.id.renderButton(btnContainer, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          shape: 'pill',
          text: 'signin_with',
          logo_alignment: 'left',
          width: 280,
        });
        return;
      } catch (e) {
        console.error('Google GSI initialisation error:', e);
      }
    }

    // Configuration missing — show a clear, actionable message (no mock fallback)
    btnContainer.innerHTML = `
      <div class="w-full max-w-[320px] py-3 px-4 bg-amber-50 border border-amber-300 rounded-2xl text-center">
        <p class="text-amber-800 font-semibold text-sm mb-1">⚙️ ยังไม่ได้ตั้งค่า Google Client ID</p>
        <p class="text-amber-700 text-xs leading-relaxed">กรุณาตั้งค่า <code class="font-mono bg-amber-100 px-1 rounded">GOOGLE_CLIENT_ID</code> ใน <code class="font-mono bg-amber-100 px-1 rounded">.dev.vars</code> แล้วรัน <code class="font-mono bg-amber-100 px-1 rounded">npm run dev</code> ใหม่อีกครั้ง</p>
      </div>
    `;
  },

  /**
   * Callback from Google Identity Services — receives a real Google JWT credential.
   * @param {{ credential: string }} response
   */
  async handleGoogleCredentialResponse(response) {
    if (!response || !response.credential) {
      API.showToast('ไม่พบข้อมูลรับรองจาก Google กรุณาลองใหม่อีกครั้ง', 'error');
      return;
    }

    try {
      API.showToast('กำลังตรวจสอบความปลอดภัยกับ Google...', 'info');
      const res = await API.post('/api/auth/google', { credential: response.credential });

      if (res && res.data) {
        API.setToken(res.data.token);
        this.currentUser = res.data.user;
        localStorage.setItem('auth_user', JSON.stringify(res.data.user));
        API.showToast(`ยินดีต้อนรับ ${res.data.user.name}`, 'success');
        this.renderAuthState();
        window.dispatchEvent(new CustomEvent('auth:login_success'));
      }
    } catch (err) {
      API.showToast(err.message || 'การเข้าสู่ระบบด้วย Google ไม่สำเร็จ', 'error');
    }
  },

  logout() {
    API.setToken(null);
    localStorage.removeItem('auth_user');
    this.currentUser = null;
    API.showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    this.renderAuthState();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  },

  isAuthenticated() {
    return !!API.getToken() && !!this.currentUser;
  },

  isAdmin() {
    return this.currentUser && this.currentUser.role === 'admin';
  },

  renderAuthState() {
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');
    const adminNavItems = document.querySelectorAll('.nav-admin-only');

    if (this.isAuthenticated()) {
      if (loginView) loginView.classList.add('hidden');
      if (dashboardView) dashboardView.classList.remove('hidden');

      // Populate user info in Sidebar
      const userNameEls = document.querySelectorAll('.user-display-name');
      const userEmailEls = document.querySelectorAll('.user-display-email');
      const userAvatarEls = document.querySelectorAll('.user-display-avatar');
      const userRoleBadges = document.querySelectorAll('.user-display-role');

      const avatarUrl = this.currentUser.picture ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(this.currentUser.email || 'user')}`;

      userNameEls.forEach((el) => (el.textContent = this.currentUser.name || 'User'));
      userEmailEls.forEach((el) => (el.textContent = this.currentUser.email || ''));
      userAvatarEls.forEach((el) => {
        if (el.tagName === 'IMG') el.src = avatarUrl;
      });

      userRoleBadges.forEach((el) => {
        if (this.isAdmin()) {
          el.textContent = '👑 Admin';
          el.className = 'user-display-role text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30';
        } else {
          el.textContent = 'Member';
          el.className = 'user-display-role text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700';
        }
      });

      // Show/Hide Admin menu in Left Sidebar
      adminNavItems.forEach((el) => {
        if (this.isAdmin()) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      });
    } else {
      if (loginView) loginView.classList.remove('hidden');
      if (dashboardView) dashboardView.classList.add('hidden');
      adminNavItems.forEach((el) => el.classList.add('hidden'));
    }
  },
};
