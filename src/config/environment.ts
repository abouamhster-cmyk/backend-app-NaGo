import dotenv from 'dotenv';
import { z } from 'zod';

// Charger les variables du fichier .env
dotenv.config();

// Schéma de validation strict des variables d'environnement
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('3000'),
  
  // Supabase
  SUPABASE_URL: z.string().url({ message: "L'URL Supabase est requise et doit être valide." }),
  SUPABASE_ANON_KEY: z.string().min(10, { message: "La clé anonyme Supabase est requise." }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10, { message: "La clé de service Supabase est requise pour les actions d'administration." }),
  
  // Redis (Pour le tracking temps réel à haute échelle)
  REDIS_URL: z.string().url({ message: "L'URL de connexion Redis est requise." }),

  // Passerelle de Paiement FedaPay
  FEDAPAY_SECRET_KEY: z.string().min(5, { message: "La clé secrète FedaPay est requise." }),
  FEDAPAY_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),

  // Optionnel : Passerelle SMS pour l'OTP (Exemple : Twilio, InfoBip ou locale)
  SMS_API_KEY: z.string().optional(),
});

// Exécuter la validation des variables d'environnement actuelles
const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Erreur de configuration de l'environnement :");
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1); // Arrête immédiatement le serveur si la config est incomplète
  }

  return result.data;
};

export const env = parseEnv();
