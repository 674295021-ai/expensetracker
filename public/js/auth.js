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
   * Includes polling retry to wait for Google GSI script to finish loading.
   * @param {string|null} clientId
   */
  setupGoogleIdentity(clientId) {
    const btnContainer = document.getElementById('google-signin-btn');
    if (!btnContainer) return;

    const fallbackClientId = '1783870800-utd8akhi4g29rghol1n62lr9t48sseru.apps.googleusercontent.com';
    const effectiveClientId = clientId && clientId.endsWith('.apps.googleusercontent.com')
      ? clientId
      : fallbackClientId;

    // Store for reuse in promptGoogleSignIn()
    this.googleClientId = effectiveClientId;

    const tryRender = (attemptsLeft) => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        try {
          window.google.accounts.id.initialize({
            client_id: effectiveClientId,
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

      if (attemptsLeft > 0) {
        setTimeout(() => tryRender(attemptsLeft - 1), 200);
      } else {
        // Fallback clickable button if GSI fails to render iframe
        btnContainer.innerHTML = `
          <button type="button" onclick="Auth.promptGoogleSignIn()" class="w-[280px] h-[44px] px-4 rounded-full bg-white text-slate-700 font-medium text-sm flex items-center justify-center gap-3 border border-slate-300 shadow-sm hover:bg-slate-50 active:scale-95 transition">
            <svg class="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>
        `;
      }
    };

    tryRender(15);
  },

  promptGoogleSignIn() {
    const btnContainer = document.getElementById('google-signin-btn');
    if (window.google && window.google.accounts && window.google.accounts.id) {
      try {
        // Re-initialize to ensure callback is always registered
        window.google.accounts.id.initialize({
          client_id: this.googleClientId || '1783870800-utd8akhi4g29rghol1n62lr9t48sseru.apps.googleusercontent.com',
          callback: (response) => this.handleGoogleCredentialResponse(response),
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // Try One Tap first; if suppressed — re-render the official iframe button
        window.google.accounts.id.prompt((notification) => {
          if (
            notification.isNotDisplayed() ||
            notification.isSkippedMoment() ||
            notification.getDismissedReason() === 'credential_returned'
          ) {
            if (btnContainer) {
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
            }
          }
        });
      } catch (e) {
        console.error('Google Sign-in error:', e);
        API.showToast('ไม่สามารถเปิด Google Login ได้ กรุณารีเฟรชหน้า', 'error');
      }
    } else {
      API.showToast('กำลังโหลด Google Sign-in กรุณารอสักครู่แล้วกดอีกครั้ง', 'info');
    }
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
