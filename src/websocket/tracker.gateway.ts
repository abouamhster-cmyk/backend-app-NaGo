import { Server, Socket } from 'socket.io';
import { RedisService } from '../services/redis.service.js';
import { supabase } from '../config/database.js';

let globalIo: Server; // Conserver une référence globale pour l'envoi hors passerelle

export const setupTrackerGateway = (io: Server) => {
  globalIo = io;

  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error("Authentification échouée. Token manquant."));

      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return next(new Error("Authentification échouée. Token invalide."));

      socket.data.userId = user.id;
      next();
    } catch (err) {
      next(new Error("Erreur interne lors de l'authentification."));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    
    // Rejoindre une chambre unique portant l'identifiant de l'utilisateur
    // Cela nous permet d'envoyer un message à un utilisateur précis en faisant : io.to(userId).emit(...)
    socket.join(userId);
    console.log(`🔌 Client connecté : ${userId} et a rejoint sa room privée.`);

    socket.on('update_location', async (coords: { latitude: number; longitude: number }) => {
      if (!coords.latitude || !coords.longitude) return;
      await RedisService.updateDriverLocation(userId, coords.latitude, coords.longitude);
    });

    socket.on('disconnect', async () => {
      console.log(`🔌 Client déconnecté : ${userId}`);
      await RedisService.removeDriverLocation(userId);
    });
  });
};

// Fonction globale hautement performante pour notifier un utilisateur précis en temps réel
export const sendRealtimeNotification = (userId: string, event: string, data: any) => {
  if (globalIo) {
    globalIo.to(userId).emit(event, data);
    console.log(`📡 Événement [${event}] envoyé en temps réel à l'utilisateur : ${userId}`);
  }
};
