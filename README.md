# NexusPay

Squelette Next.js + Prisma pour une plateforme de recharge / retrait
(paiement manuel par défaut, bascule vers un PSP comme CinetPay en changeant une variable d'environnement).

## Installation

```bash
npm install
cp .env.example .env      # puis renseigner DATABASE_URL etc.
npx prisma migrate dev --name init
npm run dev
```

## Structure

- `app/page.js` — accueil
- `app/recharge/page.js` — formulaire de recharge
- `app/recharge/confirmation/page.js` — suivi du statut (polling toutes les 4s)
- `app/retrait/page.js` — formulaire de demande de retrait
- `app/api/recharge/route.js` — création d'une recharge (appelle `lib/psp.js`)
- `app/api/recharge/[ref]/route.js` — consultation du statut
- `app/api/retrait/route.js` — création d'une demande de retrait
- `app/api/webhook/psp/route.js` — réception des notifications du PSP
- `lib/psp.js` — abstraction PSP (manuel / CinetPay)
- `prisma/schema.prisma` — modèles `User` et `Transaction`

## Interface admin (validation manuelle)

Accessible sur `/admin` (redirige vers `/admin/login` si non connecté).

1. Définir `ADMIN_PASSWORD` et `ADMIN_SESSION_SECRET` dans `.env`.
2. Se connecter sur `/admin/login` avec ce mot de passe (session cookie httpOnly, valable 12h).
3. Sur `/admin`, filtrer par statut (par défaut : `EN_ATTENTE`) et par type (recharge/retrait).
4. Pour chaque transaction : vérifier manuellement (ex: SMS de confirmation Mobile Money reçu, référence correspondante), puis cliquer **Valider** ou **Rejeter**.

⚠️ Limites actuelles à connaître :
- Le clic "Valider" change juste le statut en base — il ne crédite pas encore automatiquement le solde utilisateur (`TODO` dans `app/api/admin/transactions/[id]/route.js`).
- Pour un retrait, "Valider" suppose que l'opérateur a déjà physiquement envoyé l'argent via Mobile Money *avant* de cliquer.
- L'authentification est un simple cookie signé par mot de passe partagé — suffisant pour un usage interne à faible échelle, mais à remplacer par un vrai système de comptes (rôles, plusieurs admins, logs d'audit) avant une mise en production sérieuse.

## Passer en mode PSP automatique (CinetPay)

1. Créer un compte marchand CinetPay et récupérer `CINETPAY_APIKEY` / `CINETPAY_SITE_ID` (encaissement).
2. Pour les retraits automatiques : demander l'activation du service **Transfert/Payout** auprès de CinetPay (différent du Checkout, pas actif par défaut) et récupérer `CINETPAY_TRANSFER_PWD`.
3. Dans `.env` : `PSP_PROVIDER="cinetpay"`.
4. Configurer l'URL de webhook chez CinetPay vers `https://votre-domaine.com/api/webhook/psp`.
5. S'assurer que le solde marchand CinetPay est suffisamment approvisionné pour couvrir les retraits (les retraits sont payés depuis ce solde, alimenté par les recharges collectées).

## Solde utilisateur

- Chaque recharge validée (webhook PSP ou validation manuelle admin) **crédite** `User.balance`.
- Chaque retrait **réserve** (débite) le solde dès la demande, de façon atomique, pour empêcher un double retrait qui dépasserait le solde réel.
- Si le retrait échoue (webhook PSP en échec, ou rejet admin en mode manuel), le montant est **remboursé** automatiquement.
- ⚠️ Limite actuelle : l'utilisateur est identifié uniquement par son numéro de téléphone, sans mot de passe ni session — à remplacer par une vraie authentification avant toute mise en production (sinon n'importe qui tapant un numéro peut interagir avec le solde associé).

## À faire avant la mise en production

- Authentification utilisateur (actuellement le solde/l'identité ne sont pas vérifiés).
- Vérification du solde réel avant d'autoriser un retrait.
- Validation de la signature des webhooks PSP.
- Interface d'administration pour valider manuellement les recharges/retraits en mode "manuel".
- Rate limiting sur les routes API.
