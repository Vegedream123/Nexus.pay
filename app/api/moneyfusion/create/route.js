import { NextResponse } from 'next/server';
import { FusionPay } from 'fusionpay';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Autorise les appels depuis le domaine de ton site Atlas Capital (CORS).
// Remplace APP_ORIGIN par l'URL exacte de ton site (ex: https://tonsite.netlify.app
// ou https://tonsite.github.io), sans slash final.
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.APP_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  const headers = corsHeaders();
  try {
    const body = await request.json().catch(() => null);
    const amount = Number(body?.amount);
    const accessToken = body?.access_token;

    if (!accessToken) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401, headers });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Montant invalide.' }, { status: 400, headers });
    }

    // On ne fait JAMAIS confiance à un user_id envoyé par le client :
    // on vérifie le token de session Supabase de l'utilisateur connecté.
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Session invalide, reconnectez-vous.' }, { status: 401, headers });
    }
    const userId = userData.user.id;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, phone, email')
      .eq('id', userId)
      .single();

    // 1. Crée la demande de dépôt en base, en attente de paiement.
    const { data: depositRow, error: insertError } = await supabaseAdmin
      .from('deposit_requests')
      .insert({
        user_id: userId,
        amount,
        method_name: 'MoneyFusion',
        status: 'pending',
        provider: 'moneyfusion',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Erreur création deposit_requests :', insertError);
      return NextResponse.json({ error: 'Impossible de créer la demande de dépôt.' }, { status: 500, headers });
    }

    // 2. Crée le paiement chez MoneyFusion.
    let response;
    try {
      const payment = new FusionPay(process.env.MONEYFUSION_API_URL);
      payment
        .totalPrice(amount)
        .addArticle('Dépôt Atlas Capital', amount)
        .clientName(profile?.full_name || 'Client Atlas Capital')
        .clientNumber(profile?.phone || '')
        .addInfo({ deposit_request_id: depositRow.id, user_id: userId })
        .returnUrl(`${process.env.APP_ORIGIN}/dashboard.html?deposit=processing`)
        .webhookUrl(`${process.env.VERCEL_APP_URL}/api/moneyfusion/webhook`);

      response = await payment.makePayment();
    } catch (err) {
      console.error('Erreur MoneyFusion :', err);
      await supabaseAdmin
        .from('deposit_requests')
        .update({ status: 'rejected', admin_note: "Échec création paiement MoneyFusion : " + (err.message || '') })
        .eq('id', depositRow.id);
      return NextResponse.json({ error: "Le paiement n'a pas pu être initié." }, { status: 502, headers });
    }

    if (!response?.url) {
      await supabaseAdmin
        .from('deposit_requests')
        .update({ status: 'rejected', admin_note: 'Réponse MoneyFusion invalide' })
        .eq('id', depositRow.id);
      return NextResponse.json({ error: 'Réponse invalide du prestataire de paiement.' }, { status: 502, headers });
    }

    // Le token sert à retrouver cette demande précise quand le webhook arrive.
    const token = response.token || response.url.split('/').filter(Boolean).pop();
    await supabaseAdmin.from('deposit_requests').update({ provider_reference: token }).eq('id', depositRow.id);

    return NextResponse.json({ url: response.url }, { status: 201, headers });
  } catch (err) {
    console.error('Erreur /api/moneyfusion/create :', err);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500, headers });
  }
}
