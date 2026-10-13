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

  _currentTripId: null,
  _currentTripData: null,

  _renderTripCard(t) {
    const budget = parseFloat(t.budget) || 0;
    const spent = parseFloat(t.total_spent) || 0;
    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
    const isOver = spent > budget && budget > 0;
    const statusBadge = t.status === 'completed'
      ? `<span class="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-700">✓ เสร็จสิ้น</span>`
      : `<span class="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-100 text-indigo-700">✈ กำลังเดินทาง</span>`;

    return `
      <div onclick="Features.openTripDetailModal('${t.id}')" class="bg-white rounded-3xl p-5 border border-slate-100 shadow-soft hover:shadow-lg hover:border-indigo-200 transition cursor-pointer flex flex-col justify-between gap-4 group">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="font-bold text-slate-800 text-sm group-hover:text-indigo-600 transition flex items-center gap-1.5">
                <span>✈️ ${Features._esc(t.name)}</span>
              </div>
              <div class="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <span>📍 ${Features._esc(t.destination || 'ไม่ระบุ')}</span>
                <span>·</span>
                <span>${t.start_date} → ${t.end_date}</span>
              </div>
            </div>
            ${statusBadge}
          </div>

          ${budget > 0 ? `
            <div class="bg-slate-50/70 p-3 rounded-2xl border border-slate-100">
              <div class="flex items-center justify-between text-xs mb-1.5 font-medium">
                <span class="${isOver ? 'text-rose-600 font-bold' : 'text-slate-700'}">ใช้ไป ฿${Features._fmt(spent)}</span>
                <span class="text-slate-400">งบ ฿${Features._fmt(budget)}</span>
              </div>
              <div class="w-full bg-slate-200/60 rounded-full h-2 overflow-hidden">
                <div class="${isOver ? 'bg-rose-500' : 'bg-indigo-500'} h-full rounded-full transition-all" style="width:${pct}%"></div>
              </div>
              ${isOver ? `<p class="text-[11px] text-rose-600 mt-1.5 font-bold">⚠️ เกินงบ ฿${Features._fmt(spent - budget)}</p>` : `<p class="text-[10px] text-slate-400 mt-1">คงเหลือ ฿${Features._fmt(budget - spent)}</p>`}
            </div>
          ` : `
            <div class="bg-slate-50/70 p-3 rounded-2xl border border-slate-100 flex items-center justify-between text-xs">
              <span class="text-slate-500">ใช้จ่ายรวม</span>
              <span class="font-bold font-mono text-slate-800">฿${Features._fmt(spent)}</span>
            </div>
          `}
        </div>

        <div class="flex items-center gap-2 pt-3 border-t border-slate-100">
          <button type="button" onclick="event.stopPropagation(); Features.openTripDetailModal('${t.id}')" class="flex-1 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition flex items-center justify-center gap-1">
            🔍 ดูรายละเอียดทริป
          </button>
          <button type="button" onclick="event.stopPropagation(); Features.deleteTrip('${t.id}')" class="py-1.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold transition" title="ลบทริป">
            ลบ
          </button>
        </div>
      </div>`;
  },

  async openTripDetailModal(tripId) {
    Features._currentTripId = tripId;
    const modal = document.getElementById('trip-detail-modal');
    if (!modal) {
      console.error('[Features] trip-detail-modal element not found in DOM');
      return;
    }

    // Force show modal immediately with flex display
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    const nameEl = document.getElementById('trip-detail-name');
    if (nameEl) nameEl.textContent = 'กำลังโหลดข้อมูลทริป...';

    try {
      const res = await API.request(`/api/trips/${tripId}`);
      const data = res.data;
      if (!data) throw new Error('ไม่พบข้อมูลทริป');

      Features._currentTripData = data;
      Features.renderTripDetail(data);
    } catch (e) {
      console.error('[Features] openTripDetailModal error:', e);
      API.showToast(`โหลดรายละเอียดทริปไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  renderTripDetail(data) {
    if (!data) return;
    const trip = data.trip || data;
    if (!trip) return;
    const expenses = Array.isArray(data.expenses) ? data.expenses : [];
    const budget = parseFloat(trip.budget) || 0;
    const spent = parseFloat(trip.total_spent) || 0;
    const remaining = budget - spent;
    const isOver = spent > budget && budget > 0;
    const pct = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
    const actualPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;

    // Header
    const nameEl = document.getElementById('trip-detail-name');
    if (nameEl) nameEl.textContent = `✈️ ${trip.name}`;

    const subEl = document.getElementById('trip-detail-sub');
    if (subEl) subEl.textContent = `📍 ${trip.destination || 'ไม่ระบุจุดหมาย'} · 📅 ${trip.start_date} → ${trip.end_date}`;

    const statusBadgeEl = document.getElementById('trip-detail-status-badge');
    if (statusBadgeEl) {
      statusBadgeEl.className = trip.status === 'completed'
        ? 'px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-100 text-emerald-700'
        : 'px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-100 text-indigo-700';
      statusBadgeEl.textContent = trip.status === 'completed' ? '✓ จบทริปแล้ว' : '✈ กำลังเดินทาง';
    }

    const toggleBtn = document.getElementById('trip-toggle-status-btn');
    if (toggleBtn) {
      toggleBtn.textContent = trip.status === 'completed' ? '🔄 เปลี่ยนเป็นกำลังเดินทาง' : '✓ สรุปปิดจบทริปนี้';
    }

    // Budget card
    const budgetEl = document.getElementById('trip-detail-budget');
    if (budgetEl) budgetEl.textContent = `฿${Features._fmt(budget)}`;

    const spentEl = document.getElementById('trip-detail-spent');
    if (spentEl) spentEl.textContent = `฿${Features._fmt(spent)}`;

    const remainingEl = document.getElementById('trip-detail-remaining');
    if (remainingEl) {
      remainingEl.textContent = `${remaining < 0 ? '-' : ''}฿${Features._fmt(Math.abs(remaining))}`;
      remainingEl.className = `text-sm sm:text-base font-bold font-mono ${remaining < 0 ? 'text-rose-600' : 'text-emerald-600'} mt-0.5`;
    }

    const pctValEl = document.getElementById('trip-detail-pct-val');
    if (pctValEl) pctValEl.textContent = `${actualPct}%`;

    const barEl = document.getElementById('trip-detail-progress-bar');
    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.className = `h-full rounded-full transition-all ${isOver ? 'bg-rose-500' : 'bg-indigo-500'}`;
    }

    const warningEl = document.getElementById('trip-detail-over-warning');
    if (warningEl) {
      if (isOver) {
        warningEl.classList.remove('hidden');
        warningEl.textContent = `⚠️ ใช้จ่ายเกินงบประมาณที่ตั้งไว้ ฿${Features._fmt(spent - budget)}`;
      } else {
        warningEl.classList.add('hidden');
      }
    }

    // Category Breakdown
    const catMap = {};
    expenses.forEach((e) => {
      const cat = e.category || 'อื่นๆ';
      catMap[cat] = (catMap[cat] || 0) + (parseFloat(e.amount) || 0);
    });

    const catContainer = document.getElementById('trip-detail-categories');
    if (catContainer) {
      const catIcons = {
        'ที่พัก': '🏨',
        'การเดินทาง': '🚗',
        'อาหารและเครื่องดื่ม': '🍲',
        'ช้อปปิ้ง': '🛍️',
        'บันเทิง/สังสรรค์': '🎟️',
        'อื่นๆ': '🏷️',
      };
      const entries = Object.entries(catMap);
      if (entries.length === 0) {
        catContainer.innerHTML = `<span class="text-slate-400 text-xs">ยังไม่มีรายการค่าใช้จ่าย</span>`;
      } else {
        catContainer.innerHTML = entries.map(([cat, total]) => {
          const icon = catIcons[cat] || '🏷️';
          return `
            <div class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 flex items-center gap-1.5 font-medium shadow-2xs">
              <span>${icon}</span>
              <span class="font-bold">${Features._esc(cat)}:</span>
              <span class="font-mono text-indigo-700 font-bold">฿${Features._fmt(total)}</span>
            </div>`;
        }).join('');
      }
    }

    // Bill split calculation
    Features.updateBillSplit();

    // Timeline / Expense List
    const countEl = document.getElementById('trip-expenses-count');
    if (countEl) countEl.textContent = `${expenses.length} รายการ`;

    const listEl = document.getElementById('trip-timeline-list');
    const emptyEl = document.getElementById('trip-timeline-empty');
    if (listEl) {
      if (expenses.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
      } else {
        if (emptyEl) emptyEl.classList.add('hidden');
        listEl.innerHTML = expenses.map((exp) => {
          const amt = parseFloat(exp.amount) || 0;
          return `
            <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-slate-100/70 transition">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  💳
                </div>
                <div>
                  <div class="text-xs font-bold text-slate-800">${Features._esc(exp.note || exp.category)}</div>
                  <div class="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                    <span class="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-semibold">${Features._esc(exp.category)}</span>
                    <span>·</span>
                    <span>📅 ${exp.expense_date}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span class="font-mono font-bold text-xs sm:text-sm text-slate-800">฿${Features._fmt(amt)}</span>
                <button onclick="Features.deleteTripExpense('${exp.id}', '${trip.id}')" class="px-2 py-1 rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-700 text-xs font-semibold transition" title="ลบออกจากทริป">
                  ลบ
                </button>
              </div>
            </div>`;
        }).join('');
      }
    }
  },

  updateBillSplit() {
    if (!Features._currentTripData) return;
    const spent = parseFloat(Features._currentTripData.trip.total_spent) || 0;
    const peopleInput = document.getElementById('trip-split-people');
    const people = peopleInput ? Math.max(1, parseInt(peopleInput.value, 10) || 1) : 2;
    const perPerson = spent / people;
    const perPersonEl = document.getElementById('trip-split-per-person');
    if (perPersonEl) {
      perPersonEl.textContent = `฿${Features._fmt(perPerson)}`;
    }
  },

  async toggleTripStatus() {
    if (!Features._currentTripData) return;
    const trip = Features._currentTripData.trip;
    const newStatus = trip.status === 'completed' ? 'active' : 'completed';
    try {
      await API.request(`/api/trips/${trip.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      API.showToast(newStatus === 'completed' ? 'จบทริปเรียบร้อยแล้ว ✓' : 'เปิดทริปกำลังเดินทาง ✈️', 'success');
      Features.openTripDetailModal(trip.id);
      Features.loadTrips();
    } catch (e) {
      API.showToast(`เปลี่ยนสถานะทริปไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  openAddTripExpenseModal() {
    const modal = document.getElementById('trip-add-expense-modal');
    if (!modal) return;
    const today = new Date().toISOString().split('T')[0];
    const d = document.getElementById('trip-exp-date');
    if (d) d.value = today;
    const a = document.getElementById('trip-exp-amount');
    if (a) a.value = '';
    const n = document.getElementById('trip-exp-note');
    if (n) n.value = '';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  },

  async handleAddTripExpense() {
    if (!Features._currentTripId) return;
    const category = document.getElementById('trip-exp-category')?.value;
    const amountRaw = document.getElementById('trip-exp-amount')?.value;
    const amount = parseFloat(amountRaw);
    const expense_date = document.getElementById('trip-exp-date')?.value;
    const note = document.getElementById('trip-exp-note')?.value?.trim();

    if (!category || isNaN(amount) || amount <= 0 || !expense_date) {
      API.showToast('กรุณากรอกหมวดหมู่ จำนวนเงินที่มากกว่า 0 และวันที่', 'error');
      return;
    }

    try {
      await API.request(`/api/trips/${Features._currentTripId}/expenses`, {
        method: 'POST',
        body: JSON.stringify({ category, amount, expense_date, note }),
      });
      const modal = document.getElementById('trip-add-expense-modal');
      if (modal) modal.classList.add('hidden');
      API.showToast('บันทึกค่าใช้จ่ายในทริปสำเร็จ! 💵', 'success');
      Features.openTripDetailModal(Features._currentTripId);
      Features.loadTrips();
    } catch (e) {
      API.showToast(`บันทึกค่าใช้จ่ายไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  async deleteTripExpense(expenseId, tripId) {
    if (!confirm('ลบรายการค่าใช้จ่ายนี้ออกจากทริป?')) return;
    try {
      await API.request(`/api/trips/expenses/${expenseId}`, { method: 'DELETE' });
      API.showToast('ลบรายการออกจากทริปแล้ว', 'success');
      Features.openTripDetailModal(tripId);
      Features.loadTrips();
    } catch (e) {
      API.showToast(`ลบรายการไม่สำเร็จ: ${e.message}`, 'error');
    }
  },

  async openLinkExpenseModal() {
    const modal = document.getElementById('trip-link-modal');
    const listEl = document.getElementById('trip-link-tx-list');
    if (!modal || !listEl) return;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    listEl.innerHTML = `<div class="py-8 text-center text-slate-400 text-xs">กำลังโหลดรายการรายจ่ายของคุณ...</div>`;

    try {
      const res = await API.request('/api/transactions?limit=40');
      const transactions = (res.data?.transactions || []).filter((tx) => tx.type === 'expense');

      if (transactions.length === 0) {
        listEl.innerHTML = `<div class="py-8 text-center text-slate-400 text-xs">ไม่พบรายการรายจ่ายที่สามารถผูกได้</div>`;
        return;
      }

      listEl.innerHTML = transactions.map((tx) => {
        const amt = parseFloat(tx.amount) || 0;
        return `
          <div class="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-slate-100 transition">
            <div>
              <div class="text-xs font-bold text-slate-800">${Features._esc(tx.note || tx.category)}</div>
              <div class="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                <span class="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-semibold">${Features._esc(tx.category)}</span>
                <span>·</span>
                <span>📅 ${tx.transaction_date}</span>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="font-mono font-bold text-xs text-rose-600">-฿${Features._fmt(amt)}</span>
              <button onclick="Features.linkTransactionToTrip('${tx.id}')" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition">
                + ผูกเข้าทริป
              </button>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      listEl.innerHTML = `<div class="py-8 text-center text-rose-500 text-xs">โหลดรายการไม่สำเร็จ: ${e.message}</div>`;
    }
  },

  async linkTransactionToTrip(transactionId) {
    if (!Features._currentTripId) return;
    try {
      await API.request(`/api/trips/${Features._currentTripId}/link-transaction`, {
        method: 'POST',
        body: JSON.stringify({ transaction_id: transactionId }),
      });
      const modal = document.getElementById('trip-link-modal');
      if (modal) modal.classList.add('hidden');
      API.showToast('ผูกรายการเข้าทริปเรียบร้อยแล้ว! 🔗', 'success');
      Features.openTripDetailModal(Features._currentTripId);
      Features.loadTrips();
    } catch (e) {
      API.showToast(`ผูกรายการไม่สำเร็จ: ${e.message}`, 'error');
    }
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

      // Backend returns flat summary fields at top level (not nested in data.summary)
      const total_principal = data.total_principal || 0;
      const total_current_value = data.total_current_value || 0;
      const total_profit_loss = data.total_profit_loss || 0;
      const total_profit_loss_pct = data.total_profit_loss_pct || 0;

      // Update KPIs
      Features._setEl('inv-kpi-principal', `฿${Features._fmt(total_principal)}`);
      Features._setEl('inv-kpi-current', `฿${Features._fmt(total_current_value)}`);
      const plEl = document.getElementById('inv-kpi-pl');
      if (plEl) {
        plEl.textContent = (total_profit_loss >= 0 ? '+' : '') + `฿${Features._fmt(total_profit_loss)}`;
        plEl.className = `text-xl font-extrabold font-mono ${total_profit_loss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
      }
      const pctEl = document.getElementById('inv-kpi-pct');
      if (pctEl) {
        pctEl.textContent = (total_profit_loss_pct >= 0 ? '+' : '') + total_profit_loss_pct.toFixed(2) + '%';
        pctEl.className = `text-xl font-extrabold font-mono ${total_profit_loss_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
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

      // Render donut chart — by_asset_type from backend is an Object (Record<string, {...}>)
      // Convert to array format: [{asset_type, total_current}]
      const rawByType = data.by_asset_type || {};
      const byTypeArray = Array.isArray(rawByType)
        ? rawByType
        : Object.entries(rawByType).map(([asset_type, vals]) => ({
            asset_type,
            total_current: (vals && vals.current_value) ? vals.current_value : Number(vals) || 0,
          }));
      Features._renderInvDonut(byTypeArray);
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

    // Defensive Guard Check: ensure byType is an Array
    const safeByType = Array.isArray(byType)
      ? byType
      : Object.entries(byType || {}).map(([asset_type, total_current]) => ({
          asset_type,
          total_current: Number(total_current) || 0,
        }));

    if (!safeByType || safeByType.length === 0) return;
    const colors = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
    Features._invDonutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: safeByType.map((d) => d.asset_type || d.type || 'อื่นๆ'),
        datasets: [{
          data: safeByType.map((d) => Number(d.total_current || d.amount) || 0),
          backgroundColor: colors.slice(0, safeByType.length),
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

App.openTripDetailModal = function (id) {
  Features.openTripDetailModal(id);
};

App.openAddTripExpenseModal = function () {
  Features.openAddTripExpenseModal();
};

App.openLinkExpenseModal = function () {
  Features.openLinkExpenseModal();
};

