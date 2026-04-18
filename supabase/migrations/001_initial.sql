-- ============================================================
-- NETTO — Schema iniziale
-- ============================================================

-- Profilo utente (estende auth.users di Supabase)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  plan_expires_at TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Proprietà immobiliari
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  tax_regime TEXT NOT NULL DEFAULT 'none'
    CHECK (tax_regime IN ('none','cedolare_21','cedolare_10')),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Categorie (seed di sistema + custom utente)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  icon TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  display_order SMALLINT NOT NULL DEFAULT 100
);

-- Transazioni (incassi e costi in unica tabella)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  occurred_on DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Indici performance
CREATE INDEX IF NOT EXISTS idx_properties_user ON properties(user_id) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, occurred_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_property ON transactions(property_id, occurred_on DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Profiles: solo il proprio profilo
CREATE POLICY "profiles_own" ON profiles FOR ALL USING (auth.uid() = id);

-- Properties: solo le proprie
CREATE POLICY "properties_own" ON properties FOR ALL USING (auth.uid() = user_id);

-- Transactions: solo le proprie, non cancellate
CREATE POLICY "transactions_own" ON transactions
  FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);
CREATE POLICY "transactions_insert" ON transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "transactions_update" ON transactions
  FOR UPDATE USING (auth.uid() = user_id);

-- Categories: sistema visibile a tutti, custom solo al proprietario
CREATE POLICY "categories_read" ON categories
  FOR SELECT USING (is_system = TRUE OR auth.uid() = user_id);
CREATE POLICY "categories_write" ON categories
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_system = FALSE);

-- ============================================================
-- TRIGGER: limita proprietà in piano free
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_property_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_plan TEXT;
  property_count INT;
BEGIN
  SELECT plan INTO current_plan FROM profiles WHERE id = NEW.user_id;
  IF current_plan = 'free' THEN
    SELECT COUNT(*) INTO property_count
    FROM properties WHERE user_id = NEW.user_id AND NOT is_archived;
    IF property_count >= 1 THEN
      RAISE EXCEPTION 'FREE_PLAN_LIMIT'
        USING HINT = 'Upgrade a Pro per aggiungere più proprietà';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER check_property_limit
  BEFORE INSERT ON properties
  FOR EACH ROW EXECUTE FUNCTION enforce_property_limit();

-- Trigger: aggiorna updated_at automaticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SEED: categorie di sistema
-- ============================================================

INSERT INTO categories (name, kind, icon, is_system, display_order) VALUES
  ('Prenotazione',      'income',  '🏠', TRUE,  1),
  ('Altro incasso',     'income',  '💰', TRUE,  2),
  ('Pulizie',           'expense', '🧹', TRUE,  10),
  ('Commissione OTA',   'expense', '📱', TRUE,  11),
  ('Tassa di soggiorno','expense', '🏛️', TRUE,  12),
  ('Utenze',            'expense', '💡', TRUE,  13),
  ('Manutenzione',      'expense', '🔧', TRUE,  14),
  ('Altro costo',       'expense', '📋', TRUE,  15)
ON CONFLICT DO NOTHING;

-- Funzione: crea profilo automaticamente al signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
