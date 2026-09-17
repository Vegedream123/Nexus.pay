import { NextResponse } from 'next/server';
import { FusionPay } from 'fusionpay';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// MoneyFusion peut envoyer le webhook en JSON ou en formulaire selon les cas :
// on gère les deux, comme pour tout PSP.
async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return request.json().catch(() => ({}));
  }
  const form = await request.formData().catch(() => null);
  return form ? Object.fromEntries(form.entries()) : {};
}

export async function POST(request) {
  const body = await parseBody(request);

  // Selon la configuration du compte, la référence peut arriver sous
  // différents noms — on couvre les cas les plus courants.
  const token = body.token || body.tokenPay || body.reference || body.tokenPay?.toString();

  if (!token) {
    // On répond quand même 200 pour éviter que MoneyFusion ne réessaie
    // indéfiniment un webhook malformé.
    return NextResponse.json({ ok: true });
  }

  // ⚠️ On ne fait JAMAIS confiance au statut envoyé dans le corps du
  // webhook : on revérifie toujours auprès de MoneyFusion directement,
  // comme recommandé pour tout PSP (CinetPay, MoneyFusion, etc.).
  let verification;
  try {
    const payment = new FusionPay(process.env.MONEYFUSION_API_URL);
    verification = await payment.checkPaymentStatus(token);
  } catch (err) {
    console.error('Erreur vérification statut MoneyFusion :', err);
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  const paye = verification?.statut && verification?.data?.statut === 'paid';

  if (paye) {
    const { error } = await supabaseAdmin.rpc('confirm_moneyfusion_deposit', { p_reference: token });
    if (error) {
      console.error('Erreur confirm_moneyfusion_deposit :', error);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }
  // Si le paiement n'est pas "paid" (pending / failed / no paid), on ne
  // fait rien — la demande reste "pending" et pourra être traitée
  // manuellement par un admin si besoin.

  return NextResponse.json({ ok: true });
}
