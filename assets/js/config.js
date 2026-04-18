// assets/js/config.js
// ⚠️  COMPILA QUESTI VALORI PRIMA DI PUBBLICARE
// Istruzioni: vedi README.md → Sezione "Configurazione"

const CONFIG = {
  supabase: {
    url:     'YOUR_SUPABASE_URL',       // es. https://xxxxx.supabase.co
    anonKey: 'YOUR_SUPABASE_ANON_KEY',  // Settings → API → anon public
  },
  stripe: {
    publishableKey: 'YOUR_STRIPE_PUBLISHABLE_KEY',  // pk_live_...
    priceMonthly:   'YOUR_STRIPE_PRICE_ID_MONTHLY', // price_...
    priceYearly:    'YOUR_STRIPE_PRICE_ID_YEARLY',  // price_...
  },
};
