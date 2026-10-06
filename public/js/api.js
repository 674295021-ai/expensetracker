// Centralized API Client with JWT Bearer Token & Notification Handling

const API = {
  baseUrl: window.location.origin,

  getToken() {
    return localStorage.getItem('auth_token') || null;
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        // Token expired or invalid
        this.setToken(null);
        localStorage.removeItem('auth_user');
        window.dispatchEvent(new CustomEvent('auth:expired'));
        throw new Error((data && data.error && data.error.message) || 'Session expired. Please log in again.');
      }

      if (!response.ok) {
        const errorMsg = (data && data.error && data.error.message) || `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  // HTTP Helper methods
  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  },

  // Toast Notification System
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-600/90 border-emerald-400 text-white',
      error: 'bg-rose-600/90 border-rose-400 text-white',
      info: 'bg-indigo-600/90 border-indigo-400 text-white',
      warning: 'bg-amber-600/90 border-amber-400 text-white',
    };

    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ',
      warning: '⚠',
    };

    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md transition-all duration-300 transform translate-y-2 opacity-0 ${
      bgColors[type] || bgColors.info
    }`;

    toast.innerHTML = `
      <span class="font-bold text-lg">${icons[type] || '•'}</span>
      <span class="text-sm font-medium flex-1">${message}</span>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });

    // Remove after 3.5 seconds
    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('-translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },
};
