import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/database.js';
import { AppError } from './error.middleware.js';

// Extension de l'interface Request d'Express pour y ajouter l'utilisateur authentifié
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    telephone: string;
    role: 'client' | 'prestataire' | 'admin';
    statut_compte: 'en_attente' | 'actif' | 'restreint' | 'suspendu';
  };
}

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1. Extraction du token depuis l'en-tête "Authorization: Bearer <token>"
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError("Accès refusé. Token d'authentification manquant.", 401);
    }

    const token = authHeader.split(' ')[1];

    // 2. Vérification du jeton (JWT) avec le serveur d'authentification Supabase
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      throw new AppError("Session expirée ou invalide. Veuillez vous reconnecter.", 401);
    }

    // 3. Récupération du profil complet depuis notre table "profiles"
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, telephone, role, statut_compte')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      throw new AppError("Profil utilisateur introuvable.", 404);
    }

    // 4. Blocage immédiat si le compte est suspendu
    if (profile.statut_compte === 'suspendu') {
      throw new AppError("Votre compte a été suspendu par l'administration.", 403);
    }

    // 5. Injection de l'utilisateur dans l'objet de requête Express
    req.user = {
      id: profile.id,
      telephone: profile.telephone,
      role: profile.role as 'client' | 'prestataire' | 'admin',
      statut_compte: profile.statut_compte as 'en_attente' | 'actif' | 'restreint' | 'suspendu',
    };

    next();
  } catch (error) {
    next(error);
  }
};
