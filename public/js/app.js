// Main Application Controller & Financial Calculator Engine
// Theme: Dribbble/Figma Financial Dashboard Standard

const App = {
  transactions: [],
  summary: null,
  currentTab: 'overview',
  editingId: null,
  lastCalculatedAmount: null,

  charts: {
    category: null,
    trend: null,
    categoryAnalytics: null,
    trendAnalytics: null,
  },

  categoryPresets: {
    income: ['เงินเดือน', 'โบนัส', 'ค้าขาย/ธุรกิจ', 'เงินปันผล/ลงทุน', 'งานเสริม/ฟรีแลนซ์', 'รายรับอื่นๆ'],
    expense: ['อาหารและเครื่องดื่ม', 'การเดินทาง/น้ำมัน', 'ค่าที่พัก/สาธารณูปโภค', 'ช้อปปิ้ง/ของใช้', 'บันเทิง/สังสรรค์', 'สุขภาพ/รักษาพยาบาล', 'การศึกษา', 'รายจ่ายอื่นๆ'],
  },

  // Calculator State
  calculator: {
    expression: '',
    displayValue: '0',
    history: [],
    waitingForOperand: false,
  },

  init() {
    this.setupEventListeners();
    this.initCategoryDropdowns();
    this.setDefaultDate();
    this.initCalculator();

    window.addEventListener('auth:login_success', () => {
      this.refreshData();
      this.switchTab('overview');
    });

    window.addEventListener('auth:logout', () => {
      this.transactions = [];
      this.summary = null;
      this.destroyCharts();
    });

    if (Auth.isAuthenticated()) {
      this.refreshData();
    }
  },

  setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach((input) => {
      if (!input.value && (input.id === 'tx-date' || input.id === 'edit-tx-date')) {
        input.value = today;
      }
    });
  },

  setupEventListeners() {
    // Navigation items
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.getAttribute('data-nav');
        if (tab) this.switchTab(tab);
      });
    });

    // Mobile sidebar toggle
    const mobileSidebarToggle = document.getElementById('btn-mobile-sidebar-toggle');
    const sidebar = document.getElementById('main-sidebar');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');

    if (mobileSidebarToggle && sidebar) {
      mobileSidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('-translate-x-full');
        if (sidebarBackdrop) sidebarBackdrop.classList.toggle('hidden');
      });
    }

    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => {
        sidebar.classList.add('-translate-x-full');
        sidebarBackdrop.classList.add('hidden');
      });
    }

    // Quick Calculator trigger buttons
    document.querySelectorAll('.btn-open-quick-calc').forEach((btn) => {
      btn.addEventListener('click', () => this.openQuickCalcModal());
    });

    // Add Transaction Modal trigger buttons
    document.querySelectorAll('.btn-open-add-modal').forEach((btn) => {
      btn.addEventListener('click', () => this.openAddModal());
    });

    // Transaction form submission
    const txForm = document.getElementById('transaction-form');
    if (txForm) {
      txForm.addEventListener('submit', (e) => this.handleTransactionSubmit(e));
    }

    // Modal Close buttons
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => this.closeModals());
    });

    // Type change updates category options in Add form
    const typeRadios = document.querySelectorAll('input[name="tx-type"]');
    typeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        const selected = document.querySelector('input[name="tx-type"]:checked')?.value || 'expense';
        this.updateCategoryOptions('tx-category', selected);
      });
    });

    // Type change updates category options in Edit form
    const editTypeRadios = document.querySelectorAll('input[name="edit-tx-type"]');
    editTypeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        const selected = document.querySelector('input[name="edit-tx-type"]:checked')?.value || 'expense';
        this.updateCategoryOptions('edit-tx-category', selected);
      });
    });

    // Filters change
    const filterType = document.getElementById('filter-type');
    const filterCategory = document.getElementById('filter-category');
    const filterSearch = document.getElementById('filter-search');
    const filterStartDate = document.getElementById('filter-start-date');
    const filterEndDate = document.getElementById('filter-end-date');

    const handleFilterChange = () => this.loadTransactions();

    if (filterType) filterType.addEventListener('change', handleFilterChange);
    if (filterCategory) filterCategory.addEventListener('change', handleFilterChange);
    if (filterStartDate) filterStartDate.addEventListener('change', handleFilterChange);
    if (filterEndDate) filterEndDate.addEventListener('change', handleFilterChange);

    let searchTimeout = null;
    if (filterSearch) {
      filterSearch.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(handleFilterChange, 350);
      });
    }

    // Reset filters
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener('click', () => {
        if (filterType) filterType.value = '';
        if (filterCategory) filterCategory.value = '';
        if (filterSearch) filterSearch.value = '';
        if (filterStartDate) filterStartDate.value = '';
        if (filterEndDate) filterEndDate.value = '';
        this.loadTransactions();
      });
    }

    // Export CSV
    const exportCsvBtn = document.getElementById('btn-export-csv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => this.exportToCSV());
    }

    // Paste from Calculator button in Transaction Form
    const pasteCalcBtn = document.getElementById('btn-paste-calc');
    if (pasteCalcBtn) {
      pasteCalcBtn.addEventListener('click', () => {
        if (this.lastCalculatedAmount !== null && this.lastCalculatedAmount > 0) {
          const amountInput = document.getElementById('tx-amount');
          if (amountInput) {
            amountInput.value = this.lastCalculatedAmount;
            API.showToast(`วางจำนวนเงิน ฿${this.formatNumber(this.lastCalculatedAmount)} แล้ว`, 'success');
          }
        } else {
          API.showToast('ยังไม่มีตัวเลขที่คำนวณล่าสุด', 'info');
        }
      });
    }
  },

  switchTab(tabName) {
    if (tabName === 'admin' && !Auth.isAdmin()) {
      API.showToast('ไม่มีสิทธิ์เข้าถึงส่วนผู้ดูแลระบบ', 'error');
      return;
    }

    this.currentTab = tabName;

    // Reset scroll to top on page/tab change
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTop = 0;
    const targetTabEl = document.getElementById(`tab-${tabName}`);
    if (targetTabEl) {
      targetTabEl.scrollTop = 0;
    }

    // Update active class on sidebar navigation
    document.querySelectorAll('.nav-item').forEach((item) => {
      const target = item.getAttribute('data-nav');
      if (target === tabName) {
        item.classList.add('nav-item-active');
        item.classList.remove('text-slate-400', 'hover:bg-slate-900', 'hover:text-slate-200');
      } else {
        item.classList.remove('nav-item-active');
        item.classList.add('text-slate-400', 'hover:bg-slate-900', 'hover:text-slate-200');
      }
    });

    // Update tab visibility
    document.querySelectorAll('.tab-content').forEach((tab) => {
      tab.classList.remove('active');
    });

    const targetTabEl = document.getElementById(`tab-${tabName}`);
    if (targetTabEl) {
      targetTabEl.classList.add('active');
    }

    // Update Topbar Title
    const titleEl = document.getElementById('page-title');
    const titles = {
      overview: 'ภาพรวมการเงิน (Financial Overview)',
      transactions: 'บันทึกรายการธุรกรรม (Transactions)',
      analytics: 'รายงานและการวิเคราะห์ (Analytics & Reports)',
      calculator: 'เครื่องคิดเลขการเงิน (Financial Calculator)',
      admin: '👑 ศูนย์ควบคุมผู้ดูแลระบบ (Admin Panel)',
      settings: 'การตั้งค่าระบบ (Settings)',
      trips: '✈️ ทริปเดินทาง (Travel Mode)',
      investments: '📈 พอร์ตการลงทุน (Investment Portfolio)',
      chat: '🤖 AI ที่ปรึกษาการเงิน (Gemini Chat)',
    };
    if (titleEl) titleEl.textContent = titles[tabName] || 'Dashboard';

    // Auto-close sidebar on mobile
    const sidebar = document.getElementById('main-sidebar');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    if (sidebar && window.innerWidth < 768) {
      sidebar.classList.add('-translate-x-full');
      if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
    }

    // Tab-specific loading
    if (tabName === 'admin') {
      this.loadAdminData();
    } else if (tabName === 'overview' || tabName === 'transactions' || tabName === 'analytics') {
      this.refreshData();
      if (this.summary && (tabName === 'overview' || tabName === 'analytics')) {
        setTimeout(() => this.renderCharts(this.summary), 60);
      }
    } else if (tabName === 'trips') {
      if (typeof Features !== 'undefined') Features.loadTrips();
    } else if (tabName === 'investments') {
      if (typeof Features !== 'undefined') Features.loadInvestments();
    } else if (tabName === 'settings') {
      if (typeof Features !== 'undefined') Features.loadLineStatus();
    }
  },

  initCategoryDropdowns() {
    this.updateCategoryOptions('tx-category', 'expense');
    this.updateCategoryOptions('edit-tx-category', 'expense');

    const filterCatSelect = document.getElementById('filter-category');
    if (filterCatSelect) {
      const allCategories = [...this.categoryPresets.expense, ...this.categoryPresets.income];
      const uniqueCats = Array.from(new Set(allCategories));
      filterCatSelect.innerHTML = `<option value="">ทุกหมวดหมู่ (All Categories)</option>` +
        uniqueCats.map((c) => `<option value="${c}">${c}</option>`).join('');
    }
  },

  updateCategoryOptions(selectId, type) {
    const el = document.getElementById(selectId);
    if (!el) return;
    const list = this.categoryPresets[type] || [];
    el.innerHTML = list.map((cat) => `<option value="${cat}">${cat}</option>`).join('');
  },

  async refreshData() {
    if (!Auth.isAuthenticated()) return;
    await Promise.all([this.loadSummary(), this.loadTransactions()]);
  },

  async loadSummary() {
    try {
      const res = await API.get('/api/summary');
      if (res && res.data) {
        this.summary = res.data;
        this.renderSummaryCards(res.data);
        this.renderAnalyticsCards(res.data);
        this.renderCharts(res.data);
      }
    } catch (err) {
      console.error('Failed to load summary:', err);
    }
  },

  renderSummaryCards(summary) {
    // 1. Primary Balance Card
    const balanceMainEl = document.getElementById('balance-main-amount');
    const incomeRatioEl = document.getElementById('balance-income-pct');
    const expenseRatioEl = document.getElementById('balance-expense-pct');
    const balanceProgressBar = document.getElementById('balance-progress-bar');

    if (balanceMainEl) balanceMainEl.textContent = `฿${this.formatNumber(summary.balance)}`;

    const totalVolume = summary.total_income + summary.total_expense;
    let incomePct = 50;
    let expensePct = 50;
    if (totalVolume > 0) {
      incomePct = Math.round((summary.total_income / totalVolume) * 100);
      expensePct = 100 - incomePct;
    }

    if (incomeRatioEl) incomeRatioEl.textContent = `${incomePct}% รายรับ`;
    if (expenseRatioEl) expenseRatioEl.textContent = `${expensePct}% รายจ่าย`;
    if (balanceProgressBar) balanceProgressBar.style.width = `${incomePct}%`;

    // 2. Metric Cards
    const totalIncomeEl = document.getElementById('stat-card-income');
    const totalExpenseEl = document.getElementById('stat-card-expense');
    const totalTxEl = document.getElementById('stat-card-count');

    if (totalIncomeEl) totalIncomeEl.textContent = `฿${this.formatNumber(summary.total_income)}`;
    if (totalExpenseEl) totalExpenseEl.textContent = `฿${this.formatNumber(summary.total_expense)}`;
    if (totalTxEl) totalTxEl.textContent = `${summary.recent_count} รายการ`;
  },

  async loadTransactions() {
    const filterType = document.getElementById('filter-type')?.value || '';
    const filterCategory = document.getElementById('filter-category')?.value || '';
    const filterSearch = document.getElementById('filter-search')?.value || '';
    const filterStartDate = document.getElementById('filter-start-date')?.value || '';
    const filterEndDate = document.getElementById('filter-end-date')?.value || '';

    const params = new URLSearchParams();
    if (filterType) params.append('type', filterType);
    if (filterCategory) params.append('category', filterCategory);
    if (filterSearch) params.append('search', filterSearch);
    if (filterStartDate) params.append('startDate', filterStartDate);
    if (filterEndDate) params.append('endDate', filterEndDate);

    try {
      const res = await API.get(`/api/transactions?${params.toString()}`);
      if (res && res.data) {
        this.transactions = res.data;
        this.renderTransactionsTables(res.data);
      }
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  },

  renderTransactionsTables(list) {
    // 1. Overview recent table (max 6 items)
    const recentTbody = document.getElementById('recent-transactions-tbody');
    const recentEmpty = document.getElementById('recent-transactions-empty');
    if (recentTbody) {
      if (!list || list.length === 0) {
        recentTbody.innerHTML = '';
        if (recentEmpty) recentEmpty.classList.remove('hidden');
      } else {
        if (recentEmpty) recentEmpty.classList.add('hidden');
        recentTbody.innerHTML = list.slice(0, 6).map((tx) => this.renderTableRow(tx)).join('');
      }
    }

    // 2. Full Transactions Tab table
    const fullTbody = document.getElementById('full-transactions-tbody');
    const fullEmpty = document.getElementById('full-transactions-empty');
    if (fullTbody) {
      if (!list || list.length === 0) {
        fullTbody.innerHTML = '';
        if (fullEmpty) fullEmpty.classList.remove('hidden');
      } else {
        if (fullEmpty) fullEmpty.classList.add('hidden');
        fullTbody.innerHTML = list.map((tx) => this.renderTableRow(tx)).join('');
      }
    }
  },

  renderTableRow(tx) {
    const isIncome = tx.type === 'income';
    const amountColor = isIncome ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold';
    const amountPrefix = isIncome ? '+' : '-';
    const badgeBg = isIncome
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'bg-rose-50 text-rose-700 border border-rose-200';

    const categoryIcon = isIncome ? '💰' : '💳';

    return `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-sm">
        <td class="py-3.5 px-4 whitespace-nowrap text-slate-500 font-mono text-xs">${tx.transaction_date}</td>
        <td class="py-3.5 px-4">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-sm shadow-xs">${categoryIcon}</span>
            <div>
              <div class="font-medium text-slate-800">${this.escapeHtml(tx.category)}</div>
              <div class="text-xs text-slate-400 truncate max-w-xs">${this.escapeHtml(tx.note || '-')}</div>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4 whitespace-nowrap">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeBg}">
            ${isIncome ? 'รายรับ' : 'รายจ่าย'}
          </span>
        </td>
        <td class="py-3.5 px-4 text-right whitespace-nowrap ${amountColor}">
          ${amountPrefix}฿${this.formatNumber(tx.amount)}
        </td>
        <td class="py-3.5 px-4 text-right whitespace-nowrap">
          <div class="inline-flex items-center gap-1">
            <button onclick="App.openEditModal('${tx.id}')" class="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="แก้ไข">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            </button>
            <button onclick="App.confirmDelete('${tx.id}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="ลบ">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  },

  // Modal Handlers
  openAddModal() {
    this.editingId = null;
    const modal = document.getElementById('transaction-modal');
    const form = document.getElementById('transaction-form');
    if (form) form.reset();
    this.setDefaultDate();
    this.updateCategoryOptions('tx-category', 'expense');

    // Pre-fill amount if recently calculated
    if (this.lastCalculatedAmount && this.lastCalculatedAmount > 0) {
      const amountInput = document.getElementById('tx-amount');
      if (amountInput) amountInput.value = this.lastCalculatedAmount;
    }

    if (modal) modal.classList.remove('hidden');
  },

  openEditModal(id) {
    const item = this.transactions.find((t) => t.id === id);
    if (!item) return;

    this.editingId = id;
    const modal = document.getElementById('edit-modal');
    if (!modal) return;

    const editTypeIncome = document.getElementById('edit-tx-type-income');
    const editTypeExpense = document.getElementById('edit-tx-type-expense');
    if (item.type === 'income') {
      if (editTypeIncome) editTypeIncome.checked = true;
    } else {
      if (editTypeExpense) editTypeExpense.checked = true;
    }

    this.updateCategoryOptions('edit-tx-category', item.type);
    const editCategory = document.getElementById('edit-tx-category');
    if (editCategory) editCategory.value = item.category;

    const editAmount = document.getElementById('edit-tx-amount');
    if (editAmount) editAmount.value = item.amount;

    const editNote = document.getElementById('edit-tx-note');
    if (editNote) editNote.value = item.note || '';

    const editDate = document.getElementById('edit-tx-date');
    if (editDate) editDate.value = item.transaction_date;

    modal.classList.remove('hidden');
  },

  closeModals() {
    this.editingId = null;
    document.querySelectorAll('.modal-window').forEach((m) => m.classList.add('hidden'));
  },

  async handleTransactionSubmit(e) {
    e.preventDefault();
    const type = document.querySelector('input[name="tx-type"]:checked')?.value || 'expense';
    const category = document.getElementById('tx-category')?.value || '';
    const amount = parseFloat(document.getElementById('tx-amount')?.value || '0');
    const note = document.getElementById('tx-note')?.value || '';
    const date = document.getElementById('tx-date')?.value || '';

    if (!category) {
      API.showToast('กรุณาระบุหมวดหมู่', 'warning');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      API.showToast('กรุณากรอกจำนวนเงินให้ถูกต้อง (มากกว่า 0)', 'warning');
      return;
    }

    const payload = {
      type,
      category,
      amount,
      note: note.trim() || null,
      transaction_date: date,
    };

    try {
      await API.post('/api/transactions', payload);
      API.showToast('บันทึกรายการสำเร็จ', 'success');
      this.closeModals();
      await this.refreshData();
    } catch (err) {
      API.showToast(err.message || 'บันทึกรายการไม่สำเร็จ', 'error');
    }
  },

  async handleEditSubmit() {
    if (!this.editingId) return;

    const type = document.querySelector('input[name="edit-tx-type"]:checked')?.value || 'expense';
    const category = document.getElementById('edit-tx-category')?.value || '';
    const amount = parseFloat(document.getElementById('edit-tx-amount')?.value || '0');
    const note = document.getElementById('edit-tx-note')?.value || '';
    const date = document.getElementById('edit-tx-date')?.value || '';

    if (isNaN(amount) || amount <= 0) {
      API.showToast('กรุณากรอกจำนวนเงินให้ถูกต้อง', 'warning');
      return;
    }

    const payload = {
      type,
      category,
      amount,
      note: note.trim() || null,
      transaction_date: date,
    };

    try {
      await API.put(`/api/transactions/${this.editingId}`, payload);
      API.showToast('แก้ไขรายการสำเร็จ', 'success');
      this.closeModals();
      await this.refreshData();
    } catch (err) {
      API.showToast(err.message || 'แก้ไขรายการไม่สำเร็จ', 'error');
    }
  },

  confirmDelete(id) {
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการนี้?')) {
      this.deleteTransaction(id);
    }
  },

  async deleteTransaction(id) {
    try {
      await API.delete(`/api/transactions/${id}`);
      API.showToast('ลบรายการสำเร็จ', 'success');
      await this.refreshData();
    } catch (err) {
      API.showToast(err.message || 'ลบรายการไม่สำเร็จ', 'error');
    }
  },

  // ===================================================================
  // FINANCIAL CALCULATOR ENGINE (Quick Modal & Full Screen)
  // ===================================================================
  initCalculator() {
    this.updateCalcDisplay();
  },

  openQuickCalcModal() {
    const modal = document.getElementById('quick-calc-modal');
    if (modal) modal.classList.remove('hidden');
    this.updateCalcDisplay();
  },

  calcInput(val) {
    if (this.calculator.displayValue === '0' && !isNaN(val)) {
      this.calculator.displayValue = val;
    } else if (this.calculator.waitingForOperand) {
      this.calculator.displayValue = val;
      this.calculator.waitingForOperand = false;
    } else {
      // Prevent duplicate decimal points
      if (val === '.' && this.calculator.displayValue.includes('.')) return;
      this.calculator.displayValue += val;
    }
    this.updateCalcDisplay();
  },

  calcOperator(op) {
    const current = parseFloat(this.calculator.displayValue);
    this.calculator.expression += ` ${this.calculator.displayValue} ${op}`;
    this.calculator.waitingForOperand = true;
    this.updateCalcDisplay();
  },

  calcClear() {
    this.calculator.expression = '';
    this.calculator.displayValue = '0';
    this.calculator.waitingForOperand = false;
    this.updateCalcDisplay();
  },

  calcBackspace() {
    if (this.calculator.displayValue.length > 1) {
      this.calculator.displayValue = this.calculator.displayValue.slice(0, -1);
    } else {
      this.calculator.displayValue = '0';
    }
    this.updateCalcDisplay();
  },

  calcFinancial(type) {
    const current = parseFloat(this.calculator.displayValue) || 0;
    let result = current;
    let desc = '';

    if (type === 'vat7') {
      result = current * 1.07;
      desc = `+7% VAT`;
    } else if (type === 'wht3') {
      result = current * 0.97;
      desc = `-3% WHT`;
    } else if (type === 'save10') {
      result = current * 0.10;
      desc = `10% Savings`;
    }

    result = Math.round(result * 100) / 100;
    this.calculator.expression = `${current} (${desc})`;
    this.calculator.displayValue = String(result);
    this.calculator.waitingForOperand = true;
    this.updateCalcDisplay();
  },

  calcEquals() {
    if (!this.calculator.expression) return;

    const fullExpr = `${this.calculator.expression} ${this.calculator.displayValue}`
      .replace(/×/g, '*')
      .replace(/÷/g, '/');

    try {
      // Safe math evaluation
      const sanitized = fullExpr.replace(/[^0-9+\-*/.() ]/g, '');
      const fn = new Function(`return (${sanitized});`);
      const result = Math.round(fn() * 100) / 100;

      if (!isNaN(result) && isFinite(result)) {
        this.calculator.history.unshift(`${this.calculator.expression} ${this.calculator.displayValue} = ${result}`);
        if (this.calculator.history.length > 5) this.calculator.history.pop();

        this.calculator.expression = '';
        this.calculator.displayValue = String(result);
        this.calculator.waitingForOperand = true;
        this.updateCalcDisplay();
      }
    } catch {
      this.calculator.displayValue = 'Error';
      this.updateCalcDisplay();
    }
  },

  updateCalcDisplay() {
    const exprEls = document.querySelectorAll('.calc-expr-display');
    const valEls = document.querySelectorAll('.calc-val-display');

    exprEls.forEach((el) => (el.textContent = this.calculator.expression || ' '));
    valEls.forEach((el) => {
      const num = parseFloat(this.calculator.displayValue);
      if (!isNaN(num) && !this.calculator.displayValue.endsWith('.')) {
        el.textContent = num.toLocaleString('th-TH', { maximumFractionDigits: 4 });
      } else {
        el.textContent = this.calculator.displayValue;
      }
    });

    // Update history tape
    const historyList = document.querySelectorAll('.calc-history-list');
    historyList.forEach((el) => {
      el.innerHTML = this.calculator.history
        .map((h) => `<div class="text-xs text-slate-400 py-0.5 border-b border-slate-100">${h}</div>`)
        .join('');
    });
  },

  copyCalcResult() {
    const val = parseFloat(this.calculator.displayValue);
    if (isNaN(val) || val <= 0) {
      API.showToast('ไม่มีตัวเลขผลลัพธ์ที่ถูกต้องสำหรับคัดลอก', 'warning');
      return;
    }

    this.lastCalculatedAmount = val;

    // Clipboard copy
    if (navigator.clipboard) {
      navigator.clipboard.writeText(String(val)).catch(() => {});
    }

    API.showToast(`คัดลอกผลลัพธ์ ฿${this.formatNumber(val)} สำเร็จ นำไปใส่ในรายการได้ทันที`, 'success');

    // If Add Transaction modal is open, auto-fill it
    const amountInput = document.getElementById('tx-amount');
    if (amountInput) {
      amountInput.value = val;
    }
  },

  applyCalcToNewTransaction() {
    this.copyCalcResult();
    this.closeModals();
    this.openAddModal();
  },

  // ===================================================================
  // CHARTS & ANALYTICS RENDERING (Chart.js)
  // ===================================================================
  formatMonthLabel(monthStr) {
    if (!monthStr) return '';
    const parts = monthStr.split('-');
    if (parts.length < 2) return monthStr;
    const year = parts[0];
    const month = parts[1];
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
    ];
    const mIdx = parseInt(month, 10) - 1;
    const mName = thaiMonths[mIdx] || month;
    return `${mName} ${year}`;
  },

  renderAnalyticsCards(summary) {
    if (!summary) return;

    const incEl = document.getElementById('analytics-stat-income');
    const expEl = document.getElementById('analytics-stat-expense');
    const balEl = document.getElementById('analytics-stat-balance');
    const rateEl = document.getElementById('analytics-stat-savings-rate');
    const descEl = document.getElementById('analytics-stat-savings-desc');

    const totalIncome = summary.total_income || 0;
    const totalExpense = summary.total_expense || 0;
    const balance = summary.balance || 0;

    if (incEl) incEl.textContent = `฿${this.formatNumber(totalIncome)}`;
    if (expEl) expEl.textContent = `฿${this.formatNumber(totalExpense)}`;
    if (balEl) {
      const isPos = balance >= 0;
      balEl.textContent = `${isPos ? '+' : ''}฿${this.formatNumber(balance)}`;
      balEl.className = `text-xl sm:text-2xl font-bold font-mono ${isPos ? 'text-indigo-600' : 'text-rose-600'}`;
    }

    if (rateEl) {
      if (totalIncome > 0) {
        const rate = Math.round(((totalIncome - totalExpense) / totalIncome) * 100);
        rateEl.textContent = `${rate}%`;
        if (rate >= 20) {
          rateEl.className = 'text-xl sm:text-2xl font-bold font-mono text-emerald-600';
          if (descEl) descEl.textContent = 'ยอดเยี่ยม! อัตราการออมอยู่ในเกณฑ์ที่ดีมาก';
        } else if (rate > 0) {
          rateEl.className = 'text-xl sm:text-2xl font-bold font-mono text-amber-600';
          if (descEl) descEl.textContent = 'ดี อัตราการออมสุทธิเป็นบวก';
        } else {
          rateEl.className = 'text-xl sm:text-2xl font-bold font-mono text-rose-600';
          if (descEl) descEl.textContent = 'ระวัง! รายจ่ายสูงกว่ารายรับ';
        }
      } else {
        rateEl.textContent = '0%';
        if (descEl) descEl.textContent = 'ยังไม่มีข้อมูลรายรับในระบบ';
      }
    }
  },

  renderCategoryList(expenses, totalExpense) {
    const listEl = document.getElementById('analytics-category-list');
    if (!listEl) return;

    const entries = Object.entries(expenses || {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      listEl.innerHTML = `
        <div class="py-6 text-center text-slate-400 text-xs">
          ยังไม่มีข้อมูลค่าใช้จ่ายสำหรับคำนวณสัดส่วน
        </div>
      `;
      return;
    }

    const palette = [
      '#4f46e5', '#10b981', '#f43f5e', '#f59e0b',
      '#8b5cf6', '#06b6d4', '#ec4899', '#64748b',
      '#3b82f6', '#14b8a6',
    ];

    listEl.innerHTML = entries.map(([category, amount], idx) => {
      const color = palette[idx % palette.length];
      const pct = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
      return `
        <div class="p-2 rounded-xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
          <div class="flex items-center justify-between text-xs mb-1">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${color}"></span>
              <span class="font-semibold text-slate-700">${this.escapeHtml(category)}</span>
            </div>
            <div class="flex items-center gap-2 font-mono">
              <span class="text-slate-600 font-bold">฿${this.formatNumber(amount)}</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">${pct}%</span>
            </div>
          </div>
          <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500" style="width: ${pct}%; background-color: ${color}"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderMonthlyList(monthlyTrend) {
    const listEl = document.getElementById('analytics-monthly-list');
    if (!listEl) return;

    if (!monthlyTrend || monthlyTrend.length === 0) {
      listEl.innerHTML = `
        <div class="py-6 text-center text-slate-400 text-xs">
          ยังไม่มีข้อมูลประวัติย้อนหลัง
        </div>
      `;
      return;
    }

    listEl.innerHTML = [...monthlyTrend].reverse().map((m) => {
      const inc = m.income || 0;
      const exp = m.expense || 0;
      const net = (typeof m.net === 'number') ? m.net : (inc - exp);
      const isPos = net >= 0;
      const monthFormatted = this.formatMonthLabel(m.month);
      return `
        <div class="p-2.5 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
          <div class="font-bold text-slate-700">${monthFormatted}</div>
          <div class="flex items-center gap-2 sm:gap-3 font-mono">
            <span class="text-emerald-600 text-[11px]">+฿${this.formatNumber(inc)}</span>
            <span class="text-rose-600 text-[11px]">-฿${this.formatNumber(exp)}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isPos ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
              ${isPos ? '+' : ''}฿${this.formatNumber(net)}
            </span>
          </div>
        </div>
      `;
    }).join('');
  },

  createCategoryChart(canvasEl, expenses, isAnalytics = false) {
    const labels = Object.keys(expenses || {});
    const data = Object.values(expenses || {});
    const hasData = labels.length > 0 && data.some((v) => v > 0);
    const chartLabels = hasData ? labels : ['ยังไม่มีข้อมูลค่าใช้จ่าย'];
    const chartData = hasData ? data : [1];
    const palette = [
      '#4f46e5', '#10b981', '#f43f5e', '#f59e0b',
      '#8b5cf6', '#06b6d4', '#ec4899', '#64748b',
      '#3b82f6', '#14b8a6',
    ];
    const bgColors = hasData ? chartLabels.map((_, i) => palette[i % palette.length]) : ['#e2e8f0'];

    return new Chart(canvasEl, {
      type: 'doughnut',
      data: {
        labels: chartLabels,
        datasets: [
          {
            data: chartData,
            backgroundColor: bgColors,
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: hasData ? 6 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#64748b',
              boxWidth: 12,
              usePointStyle: true,
              font: { family: 'Plus Jakarta Sans', size: isAnalytics ? 12 : 11 },
              padding: isAnalytics ? 14 : 10,
            },
          },
          tooltip: {
            enabled: hasData,
            callbacks: {
              label: function (context) {
                const val = context.raw || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ฿${Number(val).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct}%)`;
              },
            },
          },
        },
        cutout: isAnalytics ? '65%' : '70%',
      },
    });
  },

  createTrendChart(canvasEl, monthlyTrend, isAnalytics = false) {
    const monthly = monthlyTrend || [];
    const labels = monthly.map((m) => this.formatMonthLabel(m.month));
    const incomes = monthly.map((m) => m.income || 0);
    const expenses = monthly.map((m) => m.expense || 0);
    const nets = monthly.map((m) => (m.income || 0) - (m.expense || 0));

    const datasets = [
      {
        type: 'bar',
        label: 'รายรับ (Income)',
        data: incomes,
        backgroundColor: '#10b981',
        borderRadius: 8,
        maxBarThickness: isAnalytics ? 32 : 24,
        order: 2,
      },
      {
        type: 'bar',
        label: 'รายจ่าย (Expense)',
        data: expenses,
        backgroundColor: '#f43f5e',
        borderRadius: 8,
        maxBarThickness: isAnalytics ? 32 : 24,
        order: 3,
      },
    ];

    if (isAnalytics) {
      datasets.push({
        type: 'line',
        label: 'เงินออมสุทธิ (Net Savings)',
        data: nets,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        borderWidth: 2.5,
        tension: 0.35,
        pointBackgroundColor: '#6366f1',
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: false,
        order: 1,
      });
    }

    return new Chart(canvasEl, {
      type: 'bar',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Plus Jakarta Sans', size: 11 },
            },
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Plus Jakarta Sans', size: 11 },
              callback: function (value) {
                return '฿' + Number(value).toLocaleString('th-TH');
              },
            },
          },
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: '#64748b',
              boxWidth: 12,
              usePointStyle: true,
              font: { family: 'Plus Jakarta Sans', size: 11 },
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const val = context.raw || 0;
                return ` ${context.dataset.label}: ฿${Number(val).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              },
            },
          },
        },
      },
    });
  },

  renderCharts(summary) {
    if (!window.Chart || !summary) return;
    this.destroyCharts();

    const expenses = summary.category_breakdown?.expense || {};
    const monthlyTrend = summary.monthly_trend || [];
    const totalExpense = summary.total_expense || 0;

    // Render category list & monthly list in Analytics Tab
    this.renderCategoryList(expenses, totalExpense);
    this.renderMonthlyList(monthlyTrend);

    // 1. Overview Tab Donut Chart
    const catCanvas = document.getElementById('chart-category');
    if (catCanvas) {
      this.charts.category = this.createCategoryChart(catCanvas, expenses, false);
    }

    // 2. Overview Tab Trend Chart
    const trendCanvas = document.getElementById('chart-trend');
    if (trendCanvas) {
      this.charts.trend = this.createTrendChart(trendCanvas, monthlyTrend, false);
    }

    // 3. Analytics Tab Donut Chart
    const catAnalyticsCanvas = document.getElementById('chart-category-analytics');
    if (catAnalyticsCanvas) {
      this.charts.categoryAnalytics = this.createCategoryChart(catAnalyticsCanvas, expenses, true);
    }

    // 4. Analytics Tab Trend Chart
    const trendAnalyticsCanvas = document.getElementById('chart-trend-analytics');
    if (trendAnalyticsCanvas) {
      this.charts.trendAnalytics = this.createTrendChart(trendAnalyticsCanvas, monthlyTrend, true);
    }
  },

  destroyCharts() {
    ['category', 'trend', 'categoryAnalytics', 'trendAnalytics'].forEach((key) => {
      if (this.charts[key]) {
        try {
          this.charts[key].destroy();
        } catch (e) {
          console.warn('Error destroying chart:', key, e);
        }
        this.charts[key] = null;
      }
    });
  },

  // ===================================================================
  // ADMIN PANEL LOGIC (Protected View)
  // ===================================================================
  async loadAdminData() {
    if (!Auth.isAdmin()) return;

    try {
      const [statsRes, usersRes, txRes] = await Promise.all([
        API.get('/api/admin/stats'),
        API.get('/api/admin/users'),
        API.get('/api/admin/transactions?limit=25'),
      ]);

      if (statsRes?.data) this.renderAdminStats(statsRes.data);
      if (usersRes?.data) this.renderAdminUsers(usersRes.data);
      if (txRes?.data) this.renderAdminTransactions(txRes.data);
    } catch (err) {
      API.showToast(err.message || 'โหลดข้อมูลแอดมินไม่สำเร็จ', 'error');
    }
  },

  renderAdminStats(stats) {
    const usersEl = document.getElementById('admin-stat-users');
    const txEl = document.getElementById('admin-stat-tx');
    const incomeEl = document.getElementById('admin-stat-income');
    const expenseEl = document.getElementById('admin-stat-expense');
    const balanceEl = document.getElementById('admin-stat-balance');

    if (usersEl) usersEl.textContent = stats.total_users;
    if (txEl) txEl.textContent = stats.total_transactions;
    if (incomeEl) incomeEl.textContent = `฿${this.formatNumber(stats.total_volume_income)}`;
    if (expenseEl) expenseEl.textContent = `฿${this.formatNumber(stats.total_volume_expense)}`;
    if (balanceEl) balanceEl.textContent = `฿${this.formatNumber(stats.net_system_balance)}`;
  },

  renderAdminUsers(users) {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    tbody.innerHTML = users.map((u) => {
      const isAdm = u.role === 'admin';
      const roleBadge = isAdm
        ? `<span class="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-200">👑 Admin</span>`
        : `<span class="px-2.5 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700">User</span>`;

      return `
        <tr class="hover:bg-slate-50 border-b border-slate-100 text-sm">
          <td class="py-3 px-4 flex items-center gap-3">
            <img src="${u.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.email)}`}" class="w-8 h-8 rounded-full border border-slate-200" alt="Avatar">
            <div>
              <div class="font-medium text-slate-800">${this.escapeHtml(u.name)}</div>
              <div class="text-xs text-slate-400 font-mono">${this.escapeHtml(u.email)}</div>
            </div>
          </td>
          <td class="py-3 px-4">${roleBadge}</td>
          <td class="py-3 px-4 text-center font-mono text-indigo-600 font-medium">${u.transaction_count || 0}</td>
          <td class="py-3 px-4 text-right font-semibold text-slate-800">฿${this.formatNumber(u.total_amount || 0)}</td>
          <td class="py-3 px-4 text-right text-xs text-slate-400 font-mono">${u.created_at ? u.created_at.substring(0, 10) : '-'}</td>
        </tr>
      `;
    }).join('');
  },

  renderAdminTransactions(list) {
    const tbody = document.getElementById('admin-tx-tbody');
    if (!tbody) return;

    tbody.innerHTML = list.map((tx) => {
      const isIncome = tx.type === 'income';
      const color = isIncome ? 'text-emerald-600' : 'text-rose-600';
      const prefix = isIncome ? '+' : '-';

      return `
        <tr class="hover:bg-slate-50 border-b border-slate-100 text-sm">
          <td class="py-3 px-4 font-mono text-xs text-slate-400">${tx.transaction_date}</td>
          <td class="py-3 px-4">
            <div class="text-xs font-medium text-slate-800">${this.escapeHtml(tx.user_name || '')}</div>
            <div class="text-[11px] text-slate-400 font-mono">${this.escapeHtml(tx.user_email || '')}</div>
          </td>
          <td class="py-3 px-4 font-medium">${this.escapeHtml(tx.category)}</td>
          <td class="py-3 px-4 text-xs text-slate-400 truncate max-w-xs">${this.escapeHtml(tx.note || '-')}</td>
          <td class="py-3 px-4 text-right ${color} font-semibold">${prefix}฿${this.formatNumber(tx.amount)}</td>
        </tr>
      `;
    }).join('');
  },

  // CSV Export with UTF-8 BOM
  exportToCSV() {
    if (!this.transactions || this.transactions.length === 0) {
      API.showToast('ไม่มีข้อมูลสำหรับส่งออก', 'warning');
      return;
    }

    const headers = ['วันที่ (Date)', 'ประเภท (Type)', 'หมวดหมู่ (Category)', 'จำนวนเงิน (Amount)', 'หมายเหตุ (Note)'];
    const rows = this.transactions.map((t) => [
      `"${t.transaction_date}"`,
      `"${t.type === 'income' ? 'รายรับ' : 'รายจ่าย'}"`,
      `"${t.category}"`,
      t.amount,
      `"${(t.note || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `financial-report-${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    API.showToast('ส่งออกไฟล์ CSV สำเร็จ', 'success');
  },

  formatNumber(val) {
    return Number(val || 0).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  Auth.init();
  App.init();
});
