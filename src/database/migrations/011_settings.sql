-- Module Configuration & Whitelabel
-- Ligne unique (id = 'default') : identité, thème, devise, locale, TVA,
-- règles d'annulation / no-show.

CREATE TABLE IF NOT EXISTS settings (
    id VARCHAR(32) PRIMARY KEY,
    "gymName" VARCHAR(120) NOT NULL,
    "logoUrl" VARCHAR(2048),
    "primaryColor" VARCHAR(7) NOT NULL DEFAULT '#14b8a6',
    "secondaryColor" VARCHAR(7) NOT NULL DEFAULT '#8b5cf6',
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    locale VARCHAR(8) NOT NULL DEFAULT 'fr',
    "taxRates" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "cancellationPolicy" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO settings (
    id,
    "gymName",
    "logoUrl",
    "primaryColor",
    "secondaryColor",
    currency,
    locale,
    "taxRates",
    "cancellationPolicy"
) VALUES (
    'default',
    'GymSoinsHealthy',
    NULL,
    '#14b8a6',
    '#8b5cf6',
    'EUR',
    'fr',
    '[
        {"id": "standard", "label": "TVA standard", "rate": 20},
        {"id": "reduit", "label": "TVA réduite", "rate": 10},
        {"id": "super-reduit", "label": "TVA super réduite", "rate": 5.5}
    ]'::jsonb,
    '{
        "freeCancellationHours": 24,
        "lateCancellationFeePercent": 50,
        "noShowFeePercent": 100,
        "notes": ""
    }'::jsonb
)
ON CONFLICT (id) DO NOTHING;
