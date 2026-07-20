import { Request, Response, NextFunction } from 'express';
import { supabase, supabaseAdmin } from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

export const registerUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError("Token d'authentification manquant.", 401);
    }

    const token = authHeader.split(' ')[1];

    // 1. Vérifier le jeton avec Supabase Auth
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authUser) {
      throw new AppError("Session invalide ou expirée.", 401);
    }

    const { nom, prenom, age, role, type_vehicule } = req.body;

    // Validation basique des données d'entrée
    if (!nom || !prenom || !role) {
      throw new AppError("Les champs Nom, Prénom et Rôle sont obligatoires.", 400);
    }

    if (role === 'prestataire' && !type_vehicule) {
      throw new AppError("Le type de véhicule est obligatoire pour les prestataires.", 400);
    }

    // 2. Vérifier si le profil existe déjà pour éviter les doublons
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', authUser.id)
      .single();

    if (existingProfile) {
      throw new AppError("Un profil existe déjà pour cet utilisateur.", 409);
    }

    // 3. Création du profil général dans PostgreSQL (via supabaseAdmin pour bypasser la RLS à l'insertion)
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authUser.id,
        telephone: authUser.phone,
        nom,
        prenom,
        age: age ? parseInt(age, 10) : null,
        role,
        statut_compte: role === 'prestataire' ? 'en_attente' : 'actif' // Le prestataire est "en attente" de sa vérification physique
      })
      .select()
      .single();

    if (profileError || !newProfile) {
      throw new AppError(`Erreur lors de la création du profil : ${profileError.message}`, 500);
    }

    // 4. Si c'est un prestataire, création de sa fiche technique "driver_profile"
    if (role === 'prestataire') {
      const { error: driverError } = await supabaseAdmin
        .from('driver_profiles')
        .insert({
          id: newProfile.id,
          type_vehicule,
          solde_compte: 0.00,
          en_ligne: false
        });

      if (driverError) {
        // Rollback manuel du profil général en cas d'erreur
        await supabaseAdmin.from('profiles').delete().eq('id', newProfile.id);
        throw new AppError(`Erreur lors de la création du profil technique : ${driverError.message}`, 500);
      }
    }

    res.status(201).json({
      status: 'success',
      message: "Profil créé avec succès.",
      user: newProfile
    });

  } catch (error) {
    next(error);
  }
};
