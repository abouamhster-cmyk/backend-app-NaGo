import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { supabaseAdmin } from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import { sendRealtimeNotification } from '../websocket/tracker.gateway.js';

// 1. Le prestataire déclare la somme d'espèces reçue en main propre
export const declareCashPayment = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ride_id, montant_recu } = req.body;
    const prestataireId = req.user?.id;

    if (!ride_id || montant_recu === undefined || montant_recu < 0) {
      throw new AppError("L'ID de la course et le montant reçu sont requis.", 400);
    }

    // Récupérer la course pour vérifier le prix final convenu
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('*')
      .eq('id', ride_id)
      .single();

    if (rideError || !ride) throw new AppError("Course introuvable.", 404);
    if (ride.prestataire_id !== prestataireId) throw new AppError("Action non autorisée.", 403);
    if (ride.statut !== 'termine') throw new AppError("Impossible de déclarer un paiement pour une course non terminée.", 400);

    // Enregistrer le paiement en attente de validation client
    const { data: payment, error: payError } = await supabaseAdmin
      .from('payments')
      .insert({
        ride_id,
        mode_paiement: 'especes',
        montant_total: ride.prix_final_convenu,
        montant_declare_prestataire: montant_recu,
        statut_paiement: 'en_attente'
      })
      .select()
      .single();

    if (payError || !payment) {
      throw new AppError("Un paiement a déjà été initié pour cette course.", 409);
    }

    // NOTIFIER LE CLIENT EN TEMPS RÉEL DE LA DÉCLARATION DU CHAUFFEUR
    sendRealtimeNotification(ride.client_id, 'cash_payment_declared', {
      payment_id: payment.id,
      montant_attendu: payment.montant_total,
      montant_declare: payment.montant_declare_prestataire,
    });

    res.status(201).json({
      status: 'success',
      message: "Montant déclaré. En attente de validation par le client.",
      payment
    });

  } catch (error) {
    next(error);
  }
};

// 2. Le client valide ou refuse (signale un litige) la déclaration en espèces du chauffeur
export const validateCashPayment = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { payment_id, is_valid, raison_litige } = req.body;
    const clientId = req.user?.id;

    if (!payment_id || is_valid === undefined) {
      throw new AppError("L'ID du paiement et l'état de validation sont requis.", 400);
    }

    // Récupérer les détails du paiement et de la course associée
    const { data: payment, error: payError } = await supabaseAdmin
      .from('payments')
      .select('*, rides(*)')
      .eq('id', payment_id)
      .single();

    if (payError || !payment) throw new AppError("Paiement introuvable.", 404);
    if (payment.rides.client_id !== clientId) throw new AppError("Action non autorisée.", 403);
    if (payment.statut_paiement !== 'en_attente') throw new AppError("Ce paiement a déjà été traité.", 400);

    const driverId = payment.rides.prestataire_id;

    if (is_valid === true) {
      // CAS 1: Le client confirme avoir payé le bon montant
      await supabaseAdmin
        .from('payments')
        .update({ statut_paiement: 'valide' })
        .eq('id', payment_id);

      // Incrémenter le nombre de missions réussies du conducteur
      const { data: driver } = await supabaseAdmin
        .from('driver_profiles')
        .select('nombre_missions_reussies')
        .eq('id', driverId)
        .single();

      await supabaseAdmin
        .from('driver_profiles')
        .update({ nombre_missions_reussies: (driver?.nombre_missions_reussies || 0) + 1 })
        .eq('id', driverId);

      // Notifier le prestataire en temps réel que le paiement est validé
      sendRealtimeNotification(driverId, 'payment_validated', { payment_id, status: 'valide' });

      return res.status(200).json({ status: 'success', message: "Paiement validé avec succès." });

    } else {
      // CAS 2: Le client signale un montant incorrect (LITIGE)
      if (!raison_litige) throw new AppError("Veuillez indiquer la raison du litige.", 400);

      // Mettre le paiement en statut 'litige'
      await supabaseAdmin
        .from('payments')
        .update({ statut_paiement: 'litige' })
        .eq('id', payment_id);

      // Calculer la durée de suspension (2 jours à partir de maintenant)
      const dateDebut = new Date();
      const dateFin = new Date();
      dateFin.setDate(dateDebut.getDate() + 2); // Ajoute 2 jours

      // Créer l'historique du litige
      await supabaseAdmin
        .from('disputes')
        .insert({
          payment_id,
          signale_par: clientId,
          raison: raison_litige,
          statut: 'ouvert',
          debut_restriction: dateDebut.toISOString(),
          fin_restriction: dateFin.toISOString()
        });

      // ALGORITHME DE SANCTION AUTOMATIQUE DU PRESTATAIRE :
      // 1. On restreint le compte général pour 2 jours
      await supabaseAdmin
        .from('profiles')
        .update({ statut_compte: 'restreint' })
        .eq('id', driverId);

      // 2. On baisse sa note moyenne de 0.5 points pour pénaliser son référencement algorithmique
      const { data: driverProfile } = await supabaseAdmin
        .from('driver_profiles')
        .select('note_moyenne')
        .eq('id', driverId)
        .single();

      const nouvelleNote = Math.max(0, (driverProfile?.note_moyenne || 5) - 0.5);

      await supabaseAdmin
        .from('driver_profiles')
        .update({ note_moyenne: nouvelleNote })
        .eq('id', driverId);

      // NOTIFIER LE PRESTATAIRE EN DIRECT DE SA RESTRICTION ET DE SA BAISSE DE NOTE
      sendRealtimeNotification(driverId, 'account_restricted', {
        raison: "Non-concordance du montant déclaré en espèces.",
        fin_restriction: dateFin.toISOString(),
        nouvelle_note: nouvelleNote
      });

      return res.status(200).json({
        status: 'success',
        message: "Litige enregistré. Le prestataire a été restreint de plateforme pour 2 jours."
      });
    }

  } catch (error) {
    next(error);
  }
};
