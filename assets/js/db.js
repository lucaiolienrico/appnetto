// assets/js/db.js
// Tutte le operazioni database — interfaccia pulita sopra Supabase

let _supabase = null;

function initDB(supabaseClient) {
  _supabase = supabaseClient;
}

// ─── PROFILO ───────────────────────────────────────────────

async function getProfile() {
  const { data, error } = await _supabase
    .from('profiles')
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function updateProfile(fields) {
  const { data: { user } } = await _supabase.auth.getUser();
  const { error } = await _supabase
    .from('profiles')
    .update(fields)
    .eq('id', user.id);
  if (error) throw error;
}

// ─── PROPRIETÀ ─────────────────────────────────────────────

async function getProperties() {
  const { data, error } = await _supabase
    .from('properties')
    .select('*')
    .eq('is_archived', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createProperty(fields) {
  const { data: { user } } = await _supabase.auth.getUser();
  const { data, error } = await _supabase
    .from('properties')
    .insert({ ...fields, user_id: user.id })
    .select()
    .single();
  // Il trigger PostgreSQL lancia 'FREE_PLAN_LIMIT' se piano free
  if (error) throw error;
  return data;
}

async function archiveProperty(id) {
  const { error } = await _supabase
    .from('properties')
    .update({ is_archived: true })
    .eq('id', id);
  if (error) throw error;
}

// ─── CATEGORIE ─────────────────────────────────────────────

async function getCategories() {
  const { data, error } = await _supabase
    .from('categories')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─── TRANSAZIONI ───────────────────────────────────────────

/**
 * Recupera transazioni con filtro opzionale
 * @param {Object} opts - { propertyId, from, to }
 */
async function getTransactions({ propertyId = null, from = null, to = null } = {}) {
  let q = _supabase
    .from('transactions')
    .select('*, categories(name, icon, kind), properties(name, tax_regime)')
    .is('deleted_at', null)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (propertyId) q = q.eq('property_id', propertyId);
  if (from)       q = q.gte('occurred_on', from);
  if (to)         q = q.lte('occurred_on', to);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function createTransaction(fields) {
  const { data: { user } } = await _supabase.auth.getUser();
  const { data, error } = await _supabase
    .from('transactions')
    .insert({ ...fields, user_id: user.id })
    .select('*, categories(name, icon)')
    .single();
  if (error) throw error;
  return data;
}

async function deleteTransaction(id) {
  // Soft delete: mantieni storia per report
  const { error } = await _supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── AGGREGATI per dashboard ───────────────────────────────

/**
 * Ritorna transazioni per periodo, con calcolo netto per proprietà
 */
async function getDashboardData({ propertyId = null, from, to }) {
  const txs = await getTransactions({ propertyId, from, to });
  return txs;
}

/**
 * Ultime N transazioni (feed "Oggi")
 */
async function getRecentTransactions(limit = 20) {
  const { data, error } = await _supabase
    .from('transactions')
    .select('*, categories(name, icon), properties(name)')
    .is('deleted_at', null)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
