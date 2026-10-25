-- Auth : colonne username + seed des rôles RBAC
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);

INSERT INTO roles (name, description) VALUES
    ('SUPER_ADMIN', 'Accès complet à tous les modules sous licence'),
    ('RECEPTIONIST', 'Gestion des membres, réservations, ventes boutique et fidélité'),
    ('COACH', 'Suivi des membres, plannings et programme de fidélité (lecture)'),
    ('THERAPIST', 'Soins, thérapies et dossiers clients'),
    ('CHEF', 'Cuisine healthy, plats, KDS et stocks alimentaires')
ON CONFLICT (name) DO NOTHING;
