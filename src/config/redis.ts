import { createClient } from 'redis';
import { env } from './environment.js';

// Initialisation du client Redis
const redisClient = createClient({
  url: env.REDIS_URL,
});

// Gestion des événements de connexion pour le monitoring de production
redisClient.on('connect', () => {
  console.log('🔄 Connexion en cours au serveur Redis...');
});

redisClient.on('ready', () => {
  console.log('✅ Connexion Redis établie et prête.');
});

redisClient.on('error', (err) => {
  console.error('❌ Erreur critique sur le client Redis :', err);
});

redisClient.on('end', () => {
  console.log('🔌 Connexion Redis déconnectée.');
});

// Fonction pour démarrer proprement la connexion au démarrage du serveur
export const connectRedis = async (): Promise<void> => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    console.error('❌ Impossible de se connecter à Redis au démarrage :', error);
    process.exit(1); // Arrêt du serveur si la brique critique Redis est inaccessible
  }
};

export { redisClient };
