// assets/js/app.js
// Orchestrazione principale dell'app

// ─── Stato globale ──────────────────────────────────────────
const state = {
  user:       null,
  profile:    null,
  properties: [],
  categories: [],
  transactions: [],
  activeTab:    'oggi',
  activePeriod: 'month',
  activeProperty: null,   // null = tutte
  chart:        null,
};

// ─── Init ───────────────────────────────────────────────────
async function initApp() {
  // Mostra loading
  showLoading(true);

  // Controlla parametri URL (ritorno da Stripe)
  const params = new URLSearchParams(window.location.search);
  if (params.get('success')) {
    showToast('🎉 Piano Pro attivato! Benvenuto.', 'success');
    window.history.replaceState({}, '', 'app.html');
  }
  if (params.get('canceled')) {
    showToast('Pagamento annullato.', 'info');
    window.history.replaceState({}, '', 'app.html');
  }

  // Auth check
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) { window.location.href = 'index.html'; return; }
  state.user = user;

  // Auth listener
  window._supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') window.location.href = 'index.html';
  });

  // Carica dati iniziali
  try {
    [state.profile, state.properties, state.categories] = await Promise.all([
      getProfile(),
      getProperties(),
      getCategories(),
    ]);
  } catch (e) {
    console.error('Errore caricamento dati:', e);
    showToast('Errore di connessione. Ricarica la pagina.', 'error');
    showLoading(false);
    return;
  }

  // Imposta UI utente
  document.getElementById('user-name').textContent =
    state.profile.display_name || state.user.email;
  document.getElementById('user-plan').textContent =
    state.profile.plan === 'pro' ? '✦ Pro' : 'Free';

  // Render iniziale
  renderPropertiesSelect();
  renderPropertyList();
  await refreshDashboard();

  showLoading(false);
  switchTab('oggi');
}

// ─── Tab navigation ─────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'andamento') renderChart();
}

// ─── Dashboard ──────────────────────────────────────────────
async function refreshDashboard() {
  const { from, to } = getDateRange(state.activePeriod);

  try {
    state.transactions = await getDashboardData({
      propertyId: state.activeProperty,
      from, to,
    });
  } catch (e) {
    showToast('Errore caricamento transazioni.', 'error');
    return;
  }

  // Calcola regime fiscale (se filtro per proprietà singola)
  let taxRegime = 'none';
  if (state.activeProperty) {
    const prop = state.properties.find(p => p.id === state.activeProperty);
    taxRegime = prop?.tax_regime || 'none';
  }

  const result = computeNetProfit(state.transactions, taxRegime);
  renderKPIs(result);
  renderRecentList();
  if (state.activeTab === 'andamento') renderChart();
}

function renderKPIs({ grossIncome, totalExpenses, taxAmount, netProfit, marginPct }) {
  const isPositive = netProfit >= 0;

  document.getElementById('kpi-income').textContent   = formatCurrency(grossIncome);
  document.getElementById('kpi-expenses').textContent = formatCurrency(totalExpenses);
  document.getElementById('kpi-tax').textContent      = formatCurrency(taxAmount);

  const netEl = document.getElementById('kpi-net');
  netEl.textContent  = formatCurrency(netProfit);
  netEl.className    = `kpi-value kpi-net ${isPositive ? 'positive' : 'negative'}`;

  document.getElementById('kpi-margin').textContent =
    `Margine: ${formatPct(marginPct)}`;
}

function renderRecentList() {
  const container = document.getElementById('recent-list');
  const recent    = state.transactions.slice(0, 15);

  if (recent.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>Nessuna transazione nel periodo selezionato</span>
        <small>Premi <strong>+</strong> per registrare il primo incasso</small>
      </div>`;
    return;
  }

  container.innerHTML = recent.map(tx => {
    const sign  = tx.kind === 'income' ? '+' : '−';
    const cls   = tx.kind === 'income' ? 'income' : 'expense';
    const icon  = tx.categories?.icon || (tx.kind === 'income' ? '💰' : '📋');
    const cat   = tx.categories?.name || '—';
    const prop  = tx.properties?.name || '—';
    const date  = formatDate(tx.occurred_on);

    return `
      <div class="tx-row" data-id="${tx.id}">
        <span class="tx-icon">${icon}</span>
        <div class="tx-info">
          <span class="tx-cat">${cat}</span>
          <span class="tx-meta">${prop} · ${date}</span>
          ${tx.note ? `<span class="tx-note">${tx.note}</span>` : ''}
        </div>
        <span class="tx-amount ${cls}">${sign}${formatCurrency(tx.amount)}</span>
        <button class="tx-delete" onclick="confirmDelete('${tx.id}')" title="Elimina">×</button>
      </div>`;
  }).join('');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  if (dateStr === today.toISOString().split('T')[0])     return 'Oggi';
  if (dateStr === yesterday.toISOString().split('T')[0]) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

// ─── Grafico ─────────────────────────────────────────────────
function renderChart() {
  const ctx     = document.getElementById('trend-chart');
  const txs     = state.transactions;

  let taxRegime = 'none';
  if (state.activeProperty) {
    const prop = state.properties.find(p => p.id === state.activeProperty);
    taxRegime  = prop?.tax_regime || 'none';
  }

  const months  = aggregateByMonth(txs, taxRegime);
  const labels  = months.map(m => m.month);
  const incomes = months.map(m => m.income);
  const costs   = months.map(m => m.expenses);
  const nets    = months.map(m => m.net);

  if (state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Ricavi',
          data: incomes,
          backgroundColor: 'rgba(34, 197, 94, 0.25)',
          borderColor: '#22c55e',
          borderWidth: 2,
          borderRadius: 4,
        },
        {
          label: 'Costi',
          data: costs,
          backgroundColor: 'rgba(239, 68, 68, 0.2)',
          borderColor: '#ef4444',
          borderWidth: 2,
          borderRadius: 4,
        },
        {
          label: 'Netto',
          data: nets,
          type: 'line',
          borderColor: '#f5f0e8',
          backgroundColor: 'rgba(245,240,232,0.1)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: '#f5f0e8',
          tension: 0.3,
          yAxisID: 'y',
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#a09a94', font: { family: 'DM Sans', size: 12 } }
        },
        tooltip: {
          backgroundColor: '#1a1a1e',
          borderColor: '#2a2a30',
          borderWidth: 1,
          titleColor: '#f5f0e8',
          bodyColor: '#a09a94',
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#6b6878', font: { family: 'DM Sans' } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#6b6878',
            font: { family: 'DM Sans' },
            callback: v => formatCurrency(v)
          }
        }
      }
    }
  });
}

// ─── Quick Add Sheet ─────────────────────────────────────────
function openAddSheet(defaultKind = 'income') {
  const sheet = document.getElementById('add-sheet');
  sheet.classList.add('open');
  setKind(defaultKind);
  renderCategoryOptions(defaultKind);
  renderPropertyOptions();
  document.getElementById('add-amount').value = '';
  document.getElementById('add-amount').focus();
  document.getElementById('add-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('add-note').value = '';
}

function closeAddSheet() {
  document.getElementById('add-sheet').classList.remove('open');
}

function setKind(kind) {
  document.getElementById('add-sheet').dataset.kind = kind;
  document.querySelectorAll('.kind-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.kind === kind);
  });
  renderCategoryOptions(kind);
}

function renderCategoryOptions(kind) {
  const select = document.getElementById('add-category');
  const cats   = state.categories.filter(c => c.kind === kind);
  select.innerHTML = cats.map(c =>
    `<option value="${c.id}">${c.icon} ${c.name}</option>`
  ).join('');
}

function renderPropertyOptions() {
  const select = document.getElementById('add-property');
  if (state.properties.length === 0) {
    select.innerHTML = '<option value="">Nessuna proprietà — aggiungine una</option>';
    return;
  }
  select.innerHTML = state.properties.map(p =>
    `<option value="${p.id}">${p.name}</option>`
  ).join('');
  // Preseleziona la proprietà attiva nel filtro, se esiste
  if (state.activeProperty) select.value = state.activeProperty;
}

async function saveTransaction() {
  const sheet      = document.getElementById('add-sheet');
  const kind       = sheet.dataset.kind || 'income';
  const amountRaw  = document.getElementById('add-amount').value.replace(',', '.');
  const amount     = parseFloat(amountRaw);

  if (!amount || amount <= 0) {
    showToast('Inserisci un importo valido.', 'error');
    document.getElementById('add-amount').focus();
    return;
  }

  const propertyId = document.getElementById('add-property').value;
  if (!propertyId) {
    showToast('Prima aggiungi una proprietà.', 'error');
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled    = true;
  btn.textContent = '...';

  try {
    await createTransaction({
      kind,
      amount:      amount.toFixed(2),
      property_id: propertyId,
      category_id: document.getElementById('add-category').value || null,
      occurred_on: document.getElementById('add-date').value,
      note:        document.getElementById('add-note').value.trim() || null,
    });

    closeAddSheet();
    showToast(kind === 'income' ? '✓ Incasso registrato' : '✓ Costo registrato', 'success');
    await refreshDashboard();
  } catch (e) {
    showToast('Errore nel salvataggio. Riprova.', 'error');
    console.error(e);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Salva';
  }
}

// ─── Proprietà ───────────────────────────────────────────────
function renderPropertiesSelect() {
  const sel = document.getElementById('property-filter');
  sel.innerHTML =
    `<option value="">Tutte le proprietà</option>` +
    state.properties.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');
  if (state.activeProperty) sel.value = state.activeProperty;
}

function renderPropertyList() {
  const container = document.getElementById('property-list');
  if (state.properties.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>Nessuna proprietà ancora</span>
        <small>Aggiungi il tuo primo B&B o appartamento</small>
      </div>`;
    return;
  }
  container.innerHTML = state.properties.map(p => {
    const labels = { none: 'Nessuna', cedolare_21: 'Cedolare 21%', cedolare_10: 'Cedolare 10%' };
    return `
      <div class="prop-card">
        <div class="prop-info">
          <span class="prop-name">${p.name}</span>
          <span class="prop-meta">${labels[p.tax_regime] || '—'}${p.address ? ' · ' + p.address : ''}</span>
        </div>
        <button class="prop-delete" onclick="confirmArchive('${p.id}', '${p.name.replace(/'/g,"\\'")}')">Archivia</button>
      </div>`;
  }).join('');
}

function openAddPropertyModal() {
  // Paywall se piano free e già ha 1+ proprietà
  if (state.profile.plan === 'free' && state.properties.length >= 1) {
    openPaywall();
    return;
  }
  document.getElementById('property-modal').classList.add('open');
  document.getElementById('prop-name').focus();
}

function closePropertyModal() {
  document.getElementById('property-modal').classList.remove('open');
  document.getElementById('prop-name').value    = '';
  document.getElementById('prop-address').value = '';
}

async function saveProperty() {
  const name = document.getElementById('prop-name').value.trim();
  if (!name) { showToast('Inserisci il nome della proprietà.', 'error'); return; }

  const btn = document.getElementById('save-prop-btn');
  btn.disabled = true;

  try {
    const p = await createProperty({
      name,
      address:    document.getElementById('prop-address').value.trim() || null,
      tax_regime: document.getElementById('prop-tax').value,
    });

    state.properties.push(p);
    renderPropertiesSelect();
    renderPropertyList();
    closePropertyModal();
    showToast('✓ Proprietà aggiunta.', 'success');
  } catch (e) {
    if (e.message?.includes('FREE_PLAN_LIMIT')) {
      closePropertyModal();
      openPaywall();
    } else {
      showToast('Errore nel salvataggio.', 'error');
      console.error(e);
    }
  } finally {
    btn.disabled = false;
  }
}

async function confirmArchive(id, name) {
  if (!confirm(`Archiviare "${name}"? Le transazioni restano visibili nello storico.`)) return;
  await archiveProperty(id);
  state.properties = state.properties.filter(p => p.id !== id);
  if (state.activeProperty === id) {
    state.activeProperty = null;
    document.getElementById('property-filter').value = '';
  }
  renderPropertiesSelect();
  renderPropertyList();
  await refreshDashboard();
  showToast('Proprietà archiviata.', 'info');
}

async function confirmDelete(id) {
  if (!confirm('Eliminare questa transazione? L\'azione non è reversibile.')) return;
  await deleteTransaction(id);
  await refreshDashboard();
  showToast('Transazione eliminata.', 'info');
}

// ─── Paywall / Stripe ────────────────────────────────────────
function openPaywall() {
  document.getElementById('paywall-modal').classList.add('open');
}

function closePaywall() {
  document.getElementById('paywall-modal').classList.remove('open');
}

async function startCheckout(period) {
  const priceId = period === 'monthly'
    ? CONFIG.stripe.priceMonthly
    : CONFIG.stripe.priceYearly;

  const btn = document.getElementById(`checkout-${period}`);
  btn.disabled    = true;
  btn.textContent = 'Caricamento...';

  try {
    const { data, error } = await window._supabase.functions.invoke('create-checkout', {
      body: { priceId }
    });
    if (error || !data?.url) throw error || new Error('URL non ricevuto');
    window.location.href = data.url;
  } catch (e) {
    showToast('Errore avvio pagamento. Riprova.', 'error');
    btn.disabled    = false;
    btn.textContent = period === 'monthly' ? '€7,99 / mese' : '€69 / anno';
    console.error(e);
  }
}

// ─── UI helpers ──────────────────────────────────────────────
function showLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

async function logout() {
  await window._supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ─── Event listeners (setup dopo DOMContentLoaded) ───────────
document.addEventListener('DOMContentLoaded', () => {
  // Init Supabase client (config.js deve essere caricato prima)
  window._supabase = supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  initDB(window._supabase);
  initApp();

  // Tab switch
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Periodo filtro
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activePeriod = btn.dataset.period;
      await refreshDashboard();
    });
  });

  // Filtro proprietà
  document.getElementById('property-filter').addEventListener('change', async (e) => {
    state.activeProperty = e.target.value || null;
    await refreshDashboard();
  });

  // Kind buttons nel sheet
  document.querySelectorAll('.kind-btn').forEach(btn => {
    btn.addEventListener('click', () => setKind(btn.dataset.kind));
  });

  // Chiudi sheet cliccando overlay
  document.getElementById('add-sheet-overlay').addEventListener('click', closeAddSheet);

  // Tasto Salva nel sheet
  document.getElementById('save-btn').addEventListener('click', saveTransaction);

  // Invio da tastiera nel campo importo
  document.getElementById('add-amount').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveTransaction();
  });

  // Bottone logout
  document.getElementById('logout-btn').addEventListener('click', logout);
});
