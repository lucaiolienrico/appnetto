// supabase/functions/stripe-webhook/index.ts
// Riceve eventi da Stripe e aggiorna il piano nel database

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!   // bypass RLS per aggiornare qualsiasi profilo
);

serve(async (req) => {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  // Verifica firma Stripe (sicurezza — mai saltare)
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    );
  } catch (err) {
    console.error('Firma webhook non valida:', err.message);
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  console.log('Evento ricevuto:', event.type);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (!userId) break;

        // Recupera subscription per data scadenza
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        const expiresAt = new Date(sub.current_period_end * 1000).toISOString();

        await supabase.from('profiles').update({
          plan: 'pro',
          plan_expires_at: expiresAt,
        }).eq('id', userId);

        console.log(`Piano aggiornato a PRO per utente: ${userId}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;

        const isActive = ['active', 'trialing'].includes(sub.status);
        const expiresAt = new Date(sub.current_period_end * 1000).toISOString();

        await supabase.from('profiles').update({
          plan: isActive ? 'pro' : 'free',
          plan_expires_at: isActive ? expiresAt : null,
        }).eq('id', userId);

        console.log(`Subscription aggiornata: ${sub.status} per utente: ${userId}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) break;

        await supabase.from('profiles').update({
          plan: 'free',
          plan_expires_at: null,
        }).eq('id', userId);

        console.log(`Piano tornato a FREE per utente: ${userId}`);
        break;
      }

      default:
        console.log(`Evento ignorato: ${event.type}`);
    }
  } catch (err) {
    console.error('Errore handler:', err);
    return new Response(`Handler error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
