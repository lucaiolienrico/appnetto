// assets/js/domain.js
// Calcoli finanziari puri — nessuna dipendenza esterna
// Usato sia nell'app che nei report

const TAX_RATES = {
  none:         0,
  cedolare_21:  0.21,
  cedolare_10:  0.10,
};

/**
 * Calcola il netto per un array di transazioni di UNA proprietà.
 * Tutti gli importi sono trattati come centesimi interi internamente
 * per evitare errori floating point, poi riconvertiti.
 *
 * @param {Array} transactions  - Array di {kind, amount}
 * @param {string} taxRegime    - 'none' | 'cedolare_21' | 'cedolare_10'
 * @returns {Object} { grossIncome, totalExpenses, taxAmount, netProfit, marginPct }
 */
function computeNetProfit(transactions, taxRegime = 'none') {
  let grossIncomeCents  = 0;
  let totalExpensesCents = 0;

  for (const tx of transactions) {
    // Converti a centesimi per evitare 0.1 + 0.2 = 0.30000000000000004
    const cents = Math.round(parseFloat(tx.amount) * 100);
    if (tx.kind === 'income')  grossIncomeCents  += cents;
    else                       totalExpensesCents += cents;
  }

  const rate        = TAX_RATES[taxRegime] ?? 0;
  const taxCents    = Math.round(grossIncomeCents * rate);
  const netCents    = grossIncomeCents - totalExpensesCents - taxCents;
  const marginPct   = grossIncomeCents === 0 ? 0 : netCents / grossIncomeCents;

  return {
    grossIncome:   grossIncomeCents  / 100,
    totalExpenses: totalExpensesCents / 100,
    taxAmount:     taxCents          / 100,
    netProfit:     netCents          / 100,
    marginPct,
  };
}

/**
 * Aggrega transazioni per mese — per il grafico andamento.
 * Ritorna array ordinato [{month: 'Gen', income, expenses, net}]
 */
function aggregateByMonth(transactions, taxRegime = 'none') {
  const map = {};

  for (const tx of transactions) {
    const d    = new Date(tx.occurred_on);
    const key  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
    if (!map[key]) map[key] = { income: 0, expenses: 0 };

    const cents = Math.round(parseFloat(tx.amount) * 100);
    if (tx.kind === 'income') map[key].income   += cents;
    else                      map[key].expenses += cents;
  }

  const rate = TAX_RATES[taxRegime] ?? 0;

  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => {
      const tax = Math.round(v.income * rate);
      return {
        month:    formatMonthKey(key),
        income:   v.income   / 100,
        expenses: v.expenses / 100,
        net:      (v.income - v.expenses - tax) / 100,
      };
    });
}

function formatMonthKey(key) {
  const [year, month] = key.split('-');
  const months = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  return `${months[parseInt(month) - 1]} ${year.slice(2)}`;
}

/** Formatta un numero come valuta italiana */
function formatCurrency(amount) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2
  }).format(amount);
}

/** Formatta percentuale */
function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/** Ritorna range date per filtro temporale */
function getDateRange(period) {
  const now   = new Date();
  const today = now.toISOString().split('T')[0];

  switch (period) {
    case 'today': {
      return { from: today, to: today };
    }
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case 'month': {
      const from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
      return { from, to: today };
    }
    case 'year': {
      return { from: `${now.getFullYear()}-01-01`, to: today };
    }
    default:
      return { from: today, to: today };
  }
}
