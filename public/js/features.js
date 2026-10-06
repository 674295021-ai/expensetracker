// ============================================================
// features.js — Trips, Investments, Gemini Chat, LINE Linking
// ============================================================

const Features = {
  // ---- Investment chart instance ----
  _invDonutChart: null,

  // ==========================================================
  // TRIPS — Travel Mode
  // ==========================================================

  async loadTrips() {
    const list = document.getElementById('trips-list');
    const empty = document.getElementById('trips-empty');
    if (!list) return;

    list.innerHTML = `<div class="col-span-3 py-12 text-center text-slate-400 text-xs">กำลังโหลดทริป...</div>`;
    if (empty) empty.classList.add('hidden');

    try {
      const res = await API.request('/api/trips');
      const trips = res.data || [];
      if (trips.length === 0) {
        list.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
      }
      list.innerHTML = trips.map((t) => Features._renderTripCard(t)).join('');
    } catch (e) {
      list.innerHTML = `<div class="col-span-3 py-12 text-center text-rose-500 text-xs">ไม่สามารถโหลดทริปได้: ${e.message}</div>`;
    }
  },

  _renderTripCard(t) {
    const budget = parseFloat(t.budget) || 0;
    const spent = parseFloat(t.total_spent) || 0;
    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
    const isOver = spent > budget && budget > 0;
    const statusBadge = t.status === 'completed'
      ? `<span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-700">✓ เสร็จสิ้น</span>`
      : `<span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-700">✈ กำลังดำเนิน</span>`;

    return `
      <div class="bg-white rounded-3xl p-5 border border-slate-100 shadow-soft flex flex-col gap-3">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-bold text-slate-800 text-sm">${Features._esc(t.name)}</div>
            <div class="text-[11px] text-slate-400 mt-0.5">${Features._esc(t.destination || '–')} · ${t.start_date} → ${t.end_date}</div>
          </div>
          ${statusBadge}
        </div>
        ${budget > 0 ? `
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="${isOver ? 'text-rose-600 font-semibold' : 'text-slate-600'}">ใช้ไป ฿${Features._fmt(spent)}</span>
              <span class="text-slate-400">งบ ฿${Features._fmt(budget)}</span>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div class="${isOver ? 'bg-rose-500' : 'bg-indigo-500'} h-full rounded-full transition-all" style="width:${pct}%"></div>
            </div>
            ${isOver ? `<p class="text-[11px] text-rose-600 mt-1 font-semibold">⚠️ เกินงบ ฿${Features._fmt(spent - budget)}</p>` : ''}
          </div>
        ` : `<p class="text-xs text-slate-400">ไม่ได้ตั้งงบประมาณ</p>`}
        <div class="flex gap-2 pt-2 border-t border-slate-100">
          <button onclick="Features.deleteTrip('${t.id}')" class="flex-1 py-1.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 text-xs font-semibold transition">ลบทริป</button>
        </div>
      </div>`;
  },

  async deleteTrip(id) {
    if (!confirm('ลบทริปนี้? ค่าใช้จ่ายในทริปจะถูกลบด้วย')) return;
    try {
      await API.request(`/api/trips/${id}`, { method: 'DELETE' });
      API.showToast('ลบทริปสำเร็จ', 'success');
      Features.loadTrips();
    } catch (e) {
      API.showToast(`ลบทริปไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  // ==========================================================
  // INVESTMENTS — Portfolio Tracking
  // ==========================================================

  async loadInvestments() {
    try {
      const res = await API.request('/api/investments');
      const data = res.data || {};
      const investments = data.investments || [];
      const summary = data.summary || {};

      // Update KPIs
      Features._setEl('inv-kpi-principal', `฿${Features._fmt(summary.total_principal || 0)}`);
      Features._setEl('inv-kpi-current', `฿${Features._fmt(summary.total_current || 0)}`);
      const pl = summary.total_pl || 0;
      const plEl = document.getElementById('inv-kpi-pl');
      if (plEl) {
        plEl.textContent = (pl >= 0 ? '+' : '') + `฿${Features._fmt(pl)}`;
        plEl.className = `text-xl font-extrabold font-mono ${pl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
      }
      const pct = summary.total_pl_pct || 0;
      const pctEl = document.getElementById('inv-kpi-pct');
      if (pctEl) {
        pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
        pctEl.className = `text-xl font-extrabold font-mono ${pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
      }

      // Render table
      const tbody = document.getElementById('investments-tbody');
      const emptyEl = document.getElementById('investments-empty');
      if (tbody) {
        if (investments.length === 0) {
          tbody.innerHTML = '';
          if (emptyEl) emptyEl.classList.remove('hidden');
        } else {
          if (emptyEl) emptyEl.classList.add('hidden');
          tbody.innerHTML = investments.map((inv) => {
            const pl = parseFloat(inv.current_value) - parseFloat(inv.principal);
            const positive = pl >= 0;
            return `<tr class="border-b border-slate-50 hover:bg-slate-50 transition">
              <td class="py-3 px-4">
                <div class="font-semibold text-slate-800 text-xs">${Features._esc(inv.name)}</div>
                <div class="text-[11px] text-slate-400">${Features._esc(inv.institution)}</div>
              </td>
              <td class="py-3 px-4 text-xs text-slate-500">${Features._esc(inv.asset_type)}</td>
              <td class="py-3 px-4 text-right font-mono text-xs text-slate-600">฿${Features._fmt(inv.principal)}</td>
              <td class="py-3 px-4 text-right font-mono text-xs text-indigo-600 font-semibold">฿${Features._fmt(inv.current_value)}</td>
              <td class="py-3 px-4 text-right font-mono text-xs ${positive ? 'text-emerald-600' : 'text-rose-600'} font-semibold">${positive ? '+' : ''}฿${Features._fmt(pl)}</td>
              <td class="py-3 px-4 text-right">
                <button onclick="Features.deleteInvestment('${inv.id}')" class="text-rose-400 hover:text-rose-600 text-xs font-semibold">ลบ</button>
              </td>
            </tr>`;
          }).join('');
        }
      }

      // Render donut chart by asset_type
      Features._renderInvDonut(data.by_asset_type || []);
    } catch (e) {
      API.showToast(`โหลดพอร์ตการลงทุนไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  _renderInvDonut(byType) {
    const canvas = document.getElementById('chart-inv-donut');
    if (!canvas) return;
    if (Features._invDonutChart) {
      Features._invDonutChart.destroy();
      Features._invDonutChart = null;
    }
    if (!byType || byType.length === 0) return;
    const colors = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
    Features._invDonutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: byType.map((d) => d.asset_type),
        datasets: [{
          data: byType.map((d) => d.total_current),
          backgroundColor: colors.slice(0, byType.length),
          borderWidth: 0,
        }],
      },
      options: {
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 12, boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ฿${Features._fmt(ctx.raw)} (${ctx.dataset.data.reduce((a, b) => a + b, 0) > 0 ? ((ctx.raw / ctx.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1) : 0}%)`,
            },
          },
        },
        responsive: true,
        maintainAspectRatio: false,
      },
    });
  },

  async deleteInvestment(id) {
    if (!confirm('ลบสินทรัพย์นี้ออกจากพอร์ต?')) return;
    try {
      await API.request(`/api/investments/${id}`, { method: 'DELETE' });
      API.showToast('ลบสินทรัพย์สำเร็จ', 'success');
      Features.loadInvestments();
    } catch (e) {
      API.showToast(`ลบสินทรัพย์ไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  // ==========================================================
  // LINE ACCOUNT LINKING
  // ==========================================================

  async loadLineStatus() {
    try {
      const res = await API.request('/api/line/status');
      const data = res.data || {};
      const linkedView = document.getElementById('line-linked-view');
      const unlinkedView = document.getElementById('line-unlinked-view');
      const lineUserIdDisplay = document.getElementById('line-user-id-display');

      if (data.is_linked) {
        if (linkedView) linkedView.classList.remove('hidden');
        if (unlinkedView) unlinkedView.classList.add('hidden');
        if (lineUserIdDisplay) lineUserIdDisplay.textContent = data.line_user?.display_name || '–';
      } else {
        if (linkedView) linkedView.classList.add('hidden');
        if (unlinkedView) unlinkedView.classList.remove('hidden');
      }
    } catch (e) {
      // Silently fail — LINE status is optional display
    }
  },

  async generateLineCode() {
    try {
      const res = await API.request('/api/line/link-token', { method: 'POST' });
      const token = res.data?.token || '';
      const box = document.getElementById('line-link-code-box');
      const val = document.getElementById('line-link-code-value');
      if (box && val) {
        val.textContent = `LINK ${token}`;
        box.classList.remove('hidden');
      }
      API.showToast('สร้างรหัสสำเร็จ! ส่ง "LINK [รหัส]" ให้ LINE Bot', 'success');
    } catch (e) {
      API.showToast(`สร้างรหัส LINE ไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  async unlinkLine() {
    if (!confirm('ยกเลิกการเชื่อมต่อ LINE?')) return;
    try {
      await API.request('/api/line/unlink', { method: 'POST' });
      API.showToast('ยกเลิกการเชื่อมต่อ LINE สำเร็จ', 'success');
      Features.loadLineStatus();
    } catch (e) {
      API.showToast(`ยกเลิกการเชื่อมต่อ LINE ไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  // ==========================================================
  // GEMINI CHAT
  // ==========================================================

  _chatLoading: false,

  async sendChatMessage() {
    if (Features._chatLoading) return;
    const input = document.getElementById('chat-input');
    if (!input) return;
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    input.style.height = 'auto';
    Features._appendChatBubble('user', message);

    // Loading bubble
    const loadingId = `chat-loading-${Date.now()}`;
    Features._appendChatBubble('ai', '...', loadingId);
    Features._chatLoading = true;

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
      const res = await API.request('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      // Replace loading bubble
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) {
        const replyText = res.data?.answer || res.data?.reply || 'ขออภัย ไม่สามารถตอบได้ในขณะนี้';
        loadingEl.innerHTML = Features._md(replyText);
      }
    } catch (e) {
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) {
        loadingEl.innerHTML = `<span class="text-rose-500">ข้อผิดพลาด: ${Features._esc(e.message)}</span>`;
      }
    } finally {
      Features._chatLoading = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  },

  _appendChatBubble(role, text, id) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.className = `flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`;
    div.innerHTML = `
      <div class="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${isUser ? 'bg-indigo-600' : 'bg-gradient-to-tr from-violet-600 to-indigo-500'}">
        ${isUser ? 'คุณ' : 'AI'}
      </div>
      <div ${id ? `id="${id}"` : ''} class="${isUser ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-none' : 'bg-indigo-50 text-slate-700 rounded-2xl rounded-tl-none'} px-4 py-3 text-xs max-w-[80%] whitespace-pre-wrap leading-relaxed">
        ${Features._md(text)}
      </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  // ==========================================================
  // HELPER UTILITIES
  // ==========================================================

  _fmt(val) {
    return parseFloat(val || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  _md(text) {
    // Basic markdown: bold, code
    return Features._esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code class="bg-slate-200 px-1 rounded text-[11px] font-mono">$1</code>');
  },
};

// ==========================================================
// Attach new methods to App object (for HTML onclick attrs)
// ==========================================================

App.openCreateTripModal = function () {
  const modal = document.getElementById('trip-modal');
  if (modal) {
    // Reset fields
    ['trip-name', 'trip-destination', 'trip-budget'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const today = new Date().toISOString().split('T')[0];
    const s = document.getElementById('trip-start-date');
    const e = document.getElementById('trip-end-date');
    if (s) s.value = today;
    if (e) e.value = today;
    modal.classList.remove('hidden');
  }
};

App.handleCreateTrip = async function () {
  const name = document.getElementById('trip-name')?.value?.trim();
  const destination = document.getElementById('trip-destination')?.value?.trim();
  const start_date = document.getElementById('trip-start-date')?.value;
  const end_date = document.getElementById('trip-end-date')?.value;
  const budgetRaw = document.getElementById('trip-budget')?.value;
  const budget = budgetRaw ? parseFloat(budgetRaw) : undefined;

  if (!name || !start_date || !end_date) {
    API.showToast('กรุณากรอกชื่อทริปและวันที่', 'error');
    return;
  }

  try {
    await API.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name, destination, start_date, end_date, budget }),
    });
    App.closeModals();
    API.showToast('สร้างทริปสำเร็จ! ✈️', 'success');
    Features.loadTrips();
  } catch (e) {
    API.showToast(`สร้างทริปไม่สำเร็จ: ${e.message}`, 'error');
  }
};

App.openCreateInvestmentModal = function () {
  const modal = document.getElementById('investment-modal');
  if (modal) {
    ['inv-name', 'inv-institution', 'inv-principal', 'inv-current', 'inv-note'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const typeSelect = document.getElementById('inv-asset-type');
    if (typeSelect) typeSelect.value = '';
    modal.classList.remove('hidden');
  }
};

App.handleCreateInvestment = async function () {
  const name = document.getElementById('inv-name')?.value?.trim();
  const institution = document.getElementById('inv-institution')?.value?.trim();
  const asset_type = document.getElementById('inv-asset-type')?.value;
  const principal = parseFloat(document.getElementById('inv-principal')?.value || 0);
  const current_value = parseFloat(document.getElementById('inv-current')?.value || 0);
  const note = document.getElementById('inv-note')?.value?.trim();

  if (!name || !institution || !asset_type) {
    API.showToast('กรุณากรอกชื่อ สถาบัน และประเภทสินทรัพย์', 'error');
    return;
  }
  if (isNaN(principal) || isNaN(current_value)) {
    API.showToast('กรุณากรอกมูลค่าเงินต้นและปัจจุบันให้ถูกต้อง', 'error');
    return;
  }

  try {
    await API.request('/api/investments', {
      method: 'POST',
      body: JSON.stringify({ name, institution, asset_type, principal, current_value, note }),
    });
    App.closeModals();
    API.showToast('เพิ่มสินทรัพย์สำเร็จ! 📈', 'success');
    Features.loadInvestments();
  } catch (e) {
    API.showToast(`เพิ่มสินทรัพย์ไม่สำเร็จ: ${e.message}`, 'error');
  }
};

App.sendChatMessage = function () {
  Features.sendChatMessage();
};

App.generateLineCode = function () {
  Features.generateLineCode();
};

App.unlinkLine = function () {
  Features.unlinkLine();
};
