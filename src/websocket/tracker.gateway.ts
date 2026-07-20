import { Server, Socket } from 'socket.io';
import { RedisService } from '../services/redis.service.js';
import { supabase } from '../config/database.js';

export const setupTrackerGateway = (io: Server) => {
  
  // Middleware de sécurité pour valider le JWT Supabase avant d'accepter la connexion WebSocket
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentification échouée. Token manquant."));
      }

      // Valider le token avec Supabase Auth
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return next(new Error("Authentification échouée. Token invalide."));
      }

      // Attacher l'ID utilisateur au socket pour les événements futurs
      socket.data.userId = user.id;
      next();
    } catch (err) {
      next(new Error("Erreur interne lors de l'authentification du socket."));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    console.log(`🔌 Nouveau client WebSocket connecté : ${userId} (Socket ID: ${socket.id})`);

    // 1. Réception de la position GPS en temps réel envoyée par le téléphone du prestataire
    socket.on('update_location', async (coords: { latitude: number; longitude: number }) => {
      if (!coords.latitude || !coords.longitude) return;

      // Enregistrer la position dans notre cache Redis ultra-rapide
      await RedisService.updateDriverLocation(userId, coords.latitude, coords.longitude);
      
      console.log(`📍 GPS Mis à jour - Conducteur ${userId} : Lat ${coords.latitude}, Lng ${coords.longitude}`);
    });

    // 2. Gestion de la déconnexion
    socket.on('disconnect', async () => {
      console.log(`🔌 Client WebSocket déconnecté : ${userId}`);
      // Retirer immédiatement le conducteur de la carte pour éviter que les clients ne le voient actif
      await RedisService.removeDriverLocation(userId);
    });
  });
};
