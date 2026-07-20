import { redisClient } from '../config/redis.js';

const DRIVERS_GPS_KEY = 'drivers:positions'; // Clé Redis contenant le set géospatial des conducteurs actifs

export class RedisService {
  
  // 1. Enregistrer ou mettre à jour la position GPS d'un conducteur
  static async updateDriverLocation(
    driverId: string, 
    latitude: number, 
    longitude: number
  ): Promise<void> {
    try {
      if (!redisClient.isOpen) return;

      // GEOADD stocke la latitude et la longitude associées à l'ID du conducteur
      await redisClient.geoAdd(DRIVERS_GPS_KEY, {
        longitude,
        latitude,
        member: driverId
      });
      
      // Définir une expiration de 60 secondes. Si le conducteur ne met pas à jour sa position, 
      // il est automatiquement retiré du cache (sécurité s'il perd le réseau ou éteint son téléphone)
      await redisClient.expire(DRIVERS_GPS_KEY, 60);
    } catch (error) {
      console.error(`❌ Erreur Redis lors de la mise à jour GPS pour le conducteur ${driverId} :`, error);
    }
  }

  // 2. Trouver les conducteurs actifs à proximité d'un point géographique (ex: pour le client)
  static async getNearbyDrivers(
    latitude: number,
    longitude: number,
    radiusInMeters: number
  ): Promise<any[]> {
    try {
      if (!redisClient.isOpen) return [];

      // GEOSEARCH recherche les membres (conducteurs) dans un rayon donné autour d'un point GPS
      const results = await redisClient.geoSearchWith(
        DRIVERS_GPS_KEY,
        { longitude, latitude },
        { radius: radiusInMeters, unit: 'm' },
        ['COORDINATES', 'DISTANCE']
      );

      // Formater proprement les résultats
      return results.map(item => ({
        driverId: item.member,
        distanceMeters: item.distance,
        longitude: item.coordinates?.longitude,
        latitude: item.coordinates?.latitude,
      }));
    } catch (error) {
      console.error('❌ Erreur Redis lors de la recherche des conducteurs à proximité :', error);
      return [];
    }
  }

  // 3. Retirer un conducteur de la carte (quand il se déconnecte)
  static async removeDriverLocation(driverId: string): Promise<void> {
    try {
      if (!redisClient.isOpen) return;
      await redisClient.zRem(DRIVERS_GPS_KEY, driverId);
    } catch (error) {
      console.error(`❌ Erreur Redis lors du retrait du conducteur ${driverId} :`, error);
    }
  }
}
