/**
 * Thème dynamique & whitelabel.
 *
 * Les classes Tailwind `brand-*` et `accent-*` sont mappées sur des variables
 * CSS (`--brand-500`, ...) au format « R G B », ce qui préserve les classes
 * d'opacité (`bg-brand-500/20`).
 *
 * Les nuances sont recalculées **par mode** afin de garantir un contraste AA :
 * - mode sombre : les teintes de texte sont éclaircies si nécessaire ;
 * - mode clair : les teintes de texte/action sont assombries si nécessaire.
 *
 * Les palettes calculées sont mises en cache dans localStorage pour que le
 * script inline de `index.html` puisse les appliquer avant le premier rendu
 * (aucun flash de thème).
 */

export type ThemeMode = 'light' | 'dark';

export const DEFAULT_PRIMARY_COLOR = '#14b8a6';
export const DEFAULT_SECONDARY_COLOR = '#8b5cf6';

/** Clé de cache lue par le script anti-FOUC de `index.html`. */
export const THEME_VARS_STORAGE_KEY = 'gymsoins_theme_vars';

/** Couleurs de fond utilisées pour le meta theme-color et les contrastes. */
export const THEME_SURFACE_COLORS: Record<ThemeMode, string> = {
  light: '#f8fafc',
  dark: '#020617',
};

const DARK_SURFACE = THEME_SURFACE_COLORS.dark;
const LIGHT_SURFACE = '#ffffff';
const WHITE = '#ffffff';
const BLACK = '#000000';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Convertit `#RRGGBB` en composantes RGB (null si invalide). */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;

  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** Vérifie qu'une chaîne est une couleur hexadécimale `#RRGGBB`. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function mixHex(from: string, to: string, ratio: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return from;

  return rgbToHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * channel(rgb.r) +
    0.7152 * channel(rgb.g) +
    0.0722 * channel(rgb.b)
  );
}

/** Ratio de contraste WCAG entre deux couleurs. */
export function contrastRatio(a: string, b: string): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lightest = Math.max(luminanceA, luminanceB);
  const darkest = Math.min(luminanceA, luminanceB);
  return (lightest + 0.05) / (darkest + 0.05);
}

/**
 * Rapproche progressivement `color` du blanc ou du noir jusqu'à atteindre
 * `minRatio` de contraste avec `background`.
 */
function ensureContrast(
  color: string,
  background: string,
  minRatio: number,
  toward: 'white' | 'black',
): string {
  if (contrastRatio(color, background) >= minRatio) {
    return color;
  }

  const target = toward === 'white' ? WHITE : BLACK;
  let low = 0;
  let high = 1;

  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    const candidate = mixHex(color, target, middle);
    if (contrastRatio(candidate, background) >= minRatio) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return mixHex(color, target, high);
}

function toTriplet(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb ? `${rgb.r} ${rgb.g} ${rgb.b}` : '0 0 0';
}

/**
 * Construit les 10 nuances d'une couleur pour un mode donné.
 *
 * - `300`/`400`/`500` servent principalement de texte et d'icônes : contraste
 *   AA (4.5:1) garanti sur la surface du mode.
 * - `600` sert de fond d'action avec du texte blanc : contraste AA garanti.
 */
export function buildColorScale(
  color: string,
  mode: ThemeMode,
): Record<string, string> {
  const primary = isHexColor(color) ? color : DEFAULT_PRIMARY_COLOR;

  if (mode === 'dark') {
    return {
      50: mixHex(primary, WHITE, 0.92),
      100: mixHex(primary, WHITE, 0.82),
      200: mixHex(primary, WHITE, 0.66),
      300: ensureContrast(
        mixHex(primary, WHITE, 0.42),
        DARK_SURFACE,
        4.5,
        'white',
      ),
      400: ensureContrast(
        mixHex(primary, WHITE, 0.22),
        DARK_SURFACE,
        4.5,
        'white',
      ),
      500: ensureContrast(primary, DARK_SURFACE, 4.5, 'white'),
      600: ensureContrast(mixHex(primary, BLACK, 0.12), WHITE, 4.5, 'black'),
      700: ensureContrast(mixHex(primary, BLACK, 0.28), WHITE, 4.5, 'black'),
      800: mixHex(primary, BLACK, 0.4),
      900: mixHex(primary, BLACK, 0.52),
    };
  }

  return {
    50: mixHex(primary, WHITE, 0.94),
    100: mixHex(primary, WHITE, 0.88),
    200: mixHex(primary, WHITE, 0.78),
    300: ensureContrast(primary, LIGHT_SURFACE, 4.5, 'black'),
    400: ensureContrast(mixHex(primary, BLACK, 0.08), LIGHT_SURFACE, 4.5, 'black'),
    500: ensureContrast(mixHex(primary, BLACK, 0.14), LIGHT_SURFACE, 4.5, 'black'),
    600: ensureContrast(mixHex(primary, BLACK, 0.22), LIGHT_SURFACE, 4.5, 'black'),
    // `brand-700` est utilisé comme texte sur des fonds teintés (10–20 %).
    // Une marge plus élevée que 4,5:1 sur blanc garantit AA sur ces fonds.
    700: ensureContrast(mixHex(primary, BLACK, 0.42), WHITE, 6, 'black'),
    800: mixHex(primary, BLACK, 0.54),
    900: mixHex(primary, BLACK, 0.64),
  };
}

/** Construit toutes les variables CSS d'un thème (brand + accent). */
export function buildThemeVars(
  primaryColor: string,
  secondaryColor: string,
  mode: ThemeMode,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const brand = buildColorScale(primaryColor, mode);
  const accent = buildColorScale(secondaryColor, mode);

  for (const [shade, value] of Object.entries(brand)) {
    vars[`--brand-${shade}`] = toTriplet(value);
  }
  for (const [shade, value] of Object.entries(accent)) {
    vars[`--accent-${shade}`] = toTriplet(value);
  }

  return vars;
}

/**
 * Applique les couleurs whitelabel au document et met en cache les deux
 * palettes (clair/sombre) pour le script anti-FOUC.
 */
export function applyThemeColors(
  primaryColor: string,
  secondaryColor: string,
  mode: ThemeMode,
): void {
  if (typeof document === 'undefined') return;

  const light = buildThemeVars(primaryColor, secondaryColor, 'light');
  const dark = buildThemeVars(primaryColor, secondaryColor, 'dark');
  const vars = mode === 'dark' ? dark : light;
  const root = document.documentElement;

  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  try {
    localStorage.setItem(
      THEME_VARS_STORAGE_KEY,
      JSON.stringify({ light, dark }),
    );
  } catch {
    // Stockage indisponible (navigation privée) : le thème reste fonctionnel.
  }
}

/**
 * Retourne la couleur de texte (blanche ou noire) la plus lisible sur un fond
 * donné. Utilisé notamment par l'aperçu whitelabel de la page Paramètres.
 *
 * Le blanc est privilégié lorsqu'il respecte AA ; sinon on bascule sur le noir.
 * Noir et blanc étant les deux extrêmes, l'un des deux atteint toujours 4,5:1.
 */
export function readableTextColor(
  background: string,
  light = WHITE,
  dark = '#000000',
): string {
  const lightContrast = contrastRatio(light, background);
  if (lightContrast >= 4.5) return light;

  const darkContrast = contrastRatio(dark, background);
  return darkContrast >= 4.5 || darkContrast > lightContrast ? dark : light;
}

/** Réinitialise le thème sur les couleurs par défaut du mode courant. */
export function resetThemeColors(mode: ThemeMode): void {
  applyThemeColors(DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR, mode);
}
