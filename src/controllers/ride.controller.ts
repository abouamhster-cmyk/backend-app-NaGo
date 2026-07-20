import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { RedisService } from '../services/redis.service.js';
import { supabaseAdmin } from '../config/database.js';
import { sendRealtimeNotification } from '../websocket/tracker.gateway.js';
import { AppError } from '../middlewares/error.middleware.js';
import { z } from 'zod';

// Schéma de validation pour la création d'une course
const createRideSchema = z.object({
  type_service: z.enum(['transport', 'course_achat', 'livraison_simple']),
  adresse_depart: z.string().min(3),
  latitude_depart: z.number(),
  longitude_depart: z.number(),
  adresse_arrivee: z.string().min(3),
  latitude_arrivee: z.number(),
  longitude_arrivee: z.number(),
  prix_propose_client: z.number().positive(),
});

export const getNearbyDrivers = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseFloat(req.query.radius as string) || 3000; // Rayon par défaut de 3km (3000m)

    if (isNaN(lat) || isNaN(lng)) {
      throw new AppError("Les coordonnées GPS (lat, lng) sont requises et doivent être des nombres.", 400);
    }

    // Interroger le cache ultra-rapide Redis
    const drivers = await RedisService.getNearbyDrivers(lat, lng, radius);

    res.status(200).json({
      status: 'success',
      results: drivers.length,
      drivers
    });
  } catch (error) {
    next(error);
  }
};

export const createRideRequest = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // 1. Validation stricte des données d'entrée avec Zod
    const validation = createRideSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError("Données de demande de course invalides ou incomplètes.", 400);
    }

    const {
      type_service,
      adresse_depart,
      latitude_depart,
      longitude_depart,
      adresse_arrivee,
      latitude_arrivee,
      longitude_arrivee,
      prix_propose_client,
    } = validation.data;

    const clientId = req.user?.id;
    if (!clientId) throw new AppError("Utilisateur non authentifié.", 401);

    // Formatage des points géographiques au format PostGIS Point pour PostgreSQL (WKT: Well-Known Text)
    const positionDepartWKT = `POINT(${longitude_depart} ${latitude_depart})`;
    const positionArriveeWKT = `POINT(${longitude_arrivee} ${latitude_arrivee})`;

    // 2. Enregistrement de la demande en base de données PostgreSQL
    const { data: ride, error } = await supabaseAdmin
      .from('rides')
      .insert({
        client_id: clientId,
        type_service,
        adresse_depart,
        position_depart: positionDepartWKT,
        adresse_arrivee,
        position_arrivee: positionArriveeWKT,
        prix_propose_client,
        statut: 'recherche'
      })
      .select('id, type_service, adresse_depart, adresse_arrivee, prix_propose_client, statut, created_at')
      .single();

    if (error || !ride) {
      throw new AppError(`Erreur lors de la création de la demande : ${error.message}`, 500);
    }

    // 3. TODO: Alerter en temps réel les conducteurs à proximité via WebSockets/Socket.io
    // Nous coderons l'algorithme d'attribution en temps réel à l'étape suivante.

    res.status(201).json({
      status: 'success',
      message: "Demande de course créée avec succès. En attente de propositions.",
      ride
    });

  } catch (error) {
    next(error);
  }
};


// 1. Un conducteur propose son prix pour une course
export const submitBid = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ride_id, prix_propose } = req.body;
    const prestataireId = req.user?.id;

    if (!ride_id || !prix_propose || prix_propose <= 0) {
      throw new AppError("Données de proposition invalides.", 400);
    }

    // Vérifier si la course est toujours en statut de recherche
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('client_id, statut')
      .eq('id', ride_id)
      .single();

    if (rideError || !ride) throw new AppError("Course introuvable.", 404);
    if (ride.statut !== 'recherche') throw new AppError("Cette course n'accepte plus d'offres.", 410);

    // Enregistrer la proposition de prix (Bid) dans PostgreSQL
    const { data: bid, error: bidError } = await supabaseAdmin
      .from('ride_bids')
      .insert({
        ride_id,
        prestataire_id: prestataireId,
        prix_propose
      })
      .select('id, ride_id, prix_propose, prestataire_id, created_at')
      .single();

    if (bidError || !bid) {
      throw new AppError("Vous avez déjà fait une offre sur cette course.", 409);
    }

    // Récupérer les infos simplifiées du conducteur pour les envoyer au client
    const { data: driverInfo } = await supabaseAdmin
      .from('profiles')
      .select('nom, prenom, photo_url')
      .eq('id', prestataireId)
      .single();

    // NOTIFIER LE CLIENT EN TEMPS RÉEL
    sendRealtimeNotification(ride.client_id, 'new_bid_received', {
      bid_id: bid.id,
      prix_propose: bid.prix_propose,
      driver: driverInfo
    });

    res.status(201).json({
      status: 'success',
      message: "Votre offre a été envoyée avec succès au client.",
      bid
    });

  } catch (error) {
    next(error);
  }
};

// 2. Le client accepte l'offre d'un conducteur
export const acceptBid = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { bid_id } = req.body;
    const clientId = req.user?.id;

    if (!bid_id) throw new AppError("L'ID de l'offre est requis.", 400);

    // 1. Récupérer l'offre d'enchère sélectionnée
    const { data: bid, error: bidError } = await supabaseAdmin
      .from('ride_bids')
      .select('ride_id, prestataire_id, prix_propose')
      .eq('id', bid_id)
      .single();

    if (bidError || !bid) throw new AppError("Offre introuvable.", 404);

    // 2. Sécuriser et valider que la course appartient bien au client connecté
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('client_id, statut')
      .eq('id', bid.ride_id)
      .single();

    if (rideError || !ride) throw new AppError("Course associée introuvable.", 404);
    if (ride.client_id !== clientId) throw new AppError("Action non autorisée.", 403);
    if (ride.statut !== 'recherche') throw new AppError("La course est déjà attribuée ou annulée.", 410);

    // 3. Verrouiller la course : assigner le conducteur gagnant et le prix final convenu
    const { data: updatedRide, error: updateError } = await supabaseAdmin
      .from('rides')
      .update({
        prestataire_id: bid.prestataire_id,
        prix_final_convenu: bid.prix_propose,
        statut: 'accepte'
      })
      .eq('id', bid.ride_id)
      .select()
      .single();

    if (updateError || !updatedRide) {
      throw new AppError("Erreur lors de l'attribution de la course.", 500);
    }

    // 4. NOTIFIER LE CONDUCTEUR GAGNANT EN TEMPS RÉEL
    sendRealtimeNotification(bid.prestataire_id, 'bid_accepted', {
      ride_id: updatedRide.id,
      prix_final: updatedRide.prix_final_convenu,
      adresse_depart: updatedRide.adresse_depart,
      adresse_arrivee: updatedRide.adresse_arrivee
    });

    res.status(200).json({
      status: 'success',
      message: "Offre acceptée. Le conducteur a été notifié.",
      ride: updatedRide
    });

  } catch (error) {
    next(error);
  }
};



// Mettre à jour l'étape de suivi de la course (Machine à états stricte)
export const updateRideStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ride_id, nouveau_statut } = req.body;
    const prestataireId = req.user?.id;

    if (!ride_id || !nouveau_statut) {
      throw new AppError("L'ID de la course et le nouveau statut sont requis.", 400);
    }

    // 1. Récupérer l'état actuel de la course
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('*')
      .eq('id', ride_id)
      .single();

    if (rideError || !ride) throw new AppError("Course introuvable.", 404);
    if (ride.prestataire_id !== prestataireId) throw new AppError("Action non autorisée. Vous n'êtes pas le conducteur de cette course.", 403);

    // 2. Validation stricte de la transition d'états (Machine à états)
    let updateFields: any = { statut: nouveau_statut };

    if (nouveau_statut === 'arrive_depart') {
      if (ride.statut !== 'accepte') {
        throw new AppError("Impossible de déclarer l'arrivée au départ. Statut actuel incohérent.", 400);
      }
    } 
    else if (nouveau_statut === 'en_cours') {
      if (ride.statut !== 'arrive_depart') {
        throw new AppError("Impossible de démarrer la course sans être arrivé au départ.", 400);
      }
      updateFields.started_at = new Date().toISOString(); // Enregistre l'heure de début
    } 
    else if (nouveau_statut === 'termine') {
      if (ride.statut !== 'en_cours') {
        throw new AppError("Impossible de terminer une course qui n'a pas démarré.", 400);
      }
      updateFields.ended_at = new Date().toISOString(); // Enregistre l'heure de fin
    } 
    else {
      throw new AppError("Statut de suivi demandé invalide.", 400);
    }

    // 3. Appliquer la mise à jour dans PostgreSQL
    const { data: updatedRide, error: updateError } = await supabaseAdmin
      .from('rides')
      .update(updateFields)
      .eq('id', ride_id)
      .select()
      .single();

    if (updateError || !updatedRide) {
      throw new AppError("Erreur lors de la mise à jour du statut.", 500);
    }

    // 4. NOTIFIER LE CLIENT EN TEMPS RÉEL DU CHANGEMENT D'ÉTAPE
    sendRealtimeNotification(ride.client_id, 'ride_status_updated', {
      ride_id: updatedRide.id,
      statut: updatedRide.statut,
      started_at: updatedRide.started_at,
      ended_at: updatedRide.ended_at
    });

    res.status(200).json({
      status: 'success',
      message: `Statut mis à jour avec succès : ${nouveau_statut}`,
      ride: updatedRide
    });

  } catch (error) {
    next(error);
  }
};
