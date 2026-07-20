import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { RedisService } from '../services/redis.service.js';
import { supabaseAdmin } from '../config/database.js';
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
