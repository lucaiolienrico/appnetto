# Netto — Gestione ricavi B&B e affitti brevi

> Incassi meno costi. In tempo reale.

App web per gestori di B&B e agenzie immobiliari: registra incassi e costi in pochi secondi, vedi il profitto netto aggiornato in tempo reale.

---

## Stack

- **Frontend**: HTML + CSS + JavaScript vanilla
- **Database + Auth**: Supabase (Postgres + RLS)
- **Pagamenti**: Stripe (abbonamenti ricorrenti)
- **Deploy**: Vercel (deploy automatico da GitHub)

---

## Struttura progetto

```
netto/
├── index.html                          # Login / Registrazione
├── app.html                            # App principale (SPA)
├── assets/
│   ├── css/style.css                   # Tutti gli stili
│   └── js/
│       ├── config.js                   # ⚠️  COMPILA QUESTO PRIMA
│       ├── domain.js                   # Calcoli finanziari (puro)
│       ├── db.js                       # Operazioni database
│       └── app.js                      # Logica UI
├── supabase/
│   ├── migrations/001_initial.sql      # Schema database
│   └── functions/
│       ├── create-checkout/index.ts    # Crea sessione Stripe
│       └── stripe-webhook/index.ts    # Riceve eventi Stripe
└── README.md
```

---

## Setup completo (step by step)

### 1. Fork e clona il repo

```bash
git clone https://github.com/TUO_USERNAME/netto.git
cd netto
```

### 2. Crea progetto Supabase

1. Vai su [supabase.com](https://supabase.com) → **New Project**
2. Scegli un nome e una password per il database
3. Vai su **Settings → API** e copia:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`
   - `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Applica lo schema database

Nel pannello Supabase → **SQL Editor** → incolla e esegui il contenuto di:
```
supabase/migrations/001_initial.sql
```

> ⚠️  Verifica che non ci siano errori prima di procedere.

### 4. Configura Stripe

1. Crea account su [stripe.com](https://stripe.com)
2. Dashboard Stripe → **Products** → **Add product**:
   - Crea **"Netto Pro Mensile"**: €7,99 · Recurring · Monthly
   - Crea **"Netto Pro Annuale"**: €69,00 · Recurring · Yearly
3. Copia i **Price ID** di entrambi (formato `price_xxxxx`)
4. Vai in **Developers → API keys** e copia:
   - `Publishable key` → `STRIPE_PUBLISHABLE_KEY`
   - `Secret key` → `STRIPE_SECRET_KEY`

### 5. Compila config.js

Apri `assets/js/config.js` e inserisci le tue chiavi:

```js
const CONFIG = {
  supabase: {
    url:     'https://XXXXX.supabase.co',
    anonKey: 'eyJhbGci...',
  },
  stripe: {
    publishableKey: 'pk_live_...',
    priceMonthly:   'price_...',
    priceYearly:    'price_...',
  },
};
```

### 6. Deploya le Edge Functions su Supabase

Installa la CLI di Supabase:
```bash
npm install -g supabase
supabase login
supabase link --project-ref TUO_PROJECT_REF
```

Imposta i secrets (le variabili d'ambiente delle edge functions):
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...  # lo ottieni al passo 7
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Deploya le functions:
```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

### 7. Configura il Webhook Stripe

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL endpoint:
   ```
   https://TUO_PROJECT.supabase.co/functions/v1/stripe-webhook
   ```
3. Events da ascoltare:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Clicca **Add endpoint** → copia il **Signing secret** (`whsec_...`)
5. Aggiornalo nei secrets Supabase:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### 8. Deploy su Vercel

1. Push del codice su GitHub:
   ```bash
   git add .
   git commit -m "Initial setup"
   git push origin main
   ```
2. Vai su [vercel.com](https://vercel.com) → **New Project** → importa il repo
3. Nessuna variabile d'ambiente necessaria su Vercel (le chiavi sono in `config.js`)
4. Click **Deploy** — l'app è online!

---

## Test con Stripe in modalità Test

Prima di andare live, testa tutto con le chiavi **test** di Stripe (`sk_test_...`, `pk_test_...`):

Carta di test: `4242 4242 4242 4242` · scadenza qualsiasi futura · CVV qualsiasi

Flusso da testare:
1. Registra un account
2. Aggiungi una proprietà
3. Inserisci alcuni movimenti
4. Clicca "Aggiungi proprietà" di nuovo → deve apparire il paywall
5. Clicca "€7,99 / mese" → vai su Stripe → paga con carta test
6. Verifica che il piano nel tuo profilo Supabase sia aggiornato a `pro`
7. Verifica di poter aggiungere la seconda proprietà

Quando tutto funziona → sostituisci le chiavi test con quelle **live** e rideploya.

---

## Regime fiscale — nota importante

Il calcolo della cedolare secca (21% o 10%) è un'**approssimazione operativa** applicata sul totale degli incassi lordi, utile per dare all'host una stima realistica del netto.

Il calcolo fiscale preciso dipende da molti fattori (deduzioni, situazione personale, tipo di contratto). L'app mostra un disclaimer e non sostituisce un commercialista.

---

## Personalizzare i prezzi

Modifica i Price ID in `assets/js/config.js` con quelli del tuo account Stripe. Puoi cambiare i prezzi direttamente dal pannello Stripe senza toccare il codice.

---

## Aggiungere categorie personalizzate

Le categorie di sistema sono definite nella migration SQL (seed). Per aggiungerne di nuove:

```sql
INSERT INTO categories (name, kind, icon, is_system, display_order)
VALUES ('Nome categoria', 'expense', '🔑', TRUE, 20);
```

---

## Roadmap futura

- [ ] Export report PDF mensile
- [ ] Widget iOS home screen
- [ ] Notifiche push settimanali ("Ecco il tuo netto di questa settimana")
- [ ] Confronto anno precedente
- [ ] Multi-utente per agenzie (gestione per proprietario)

---

## Licenza

MIT — fai quello che vuoi, ma non rimuovere il copyright.

---

Costruito con ☕ e troppi fogli Excel rotti.
