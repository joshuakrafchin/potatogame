// Pixel art color palette — Irish farm retro theme
export const COLORS = {
  // Greens (Irish hills)
  GREEN_DARK: '#2d5a1e',
  GREEN_MID: '#4a8c3f',
  GREEN_LIGHT: '#7bc96f',
  GREEN_PALE: '#b5e8a3',

  // Earth / Potato browns
  BROWN_DARK: '#5c3d2e',
  BROWN_MID: '#8b6914',
  BROWN_LIGHT: '#c4a35a',
  POTATO_SKIN: '#c9a84c',
  POTATO_FLESH: '#f5e6b8',

  // Sky
  SKY_BLUE: '#87ceeb',
  SKY_LIGHT: '#c5e8f7',

  // Heat / Danger
  HOT_ORANGE: '#ff8c42',
  HOT_RED: '#ff4444',
  DANGER_RED: '#cc0000',
  FLAME_YELLOW: '#ffd700',

  // UI
  WHITE: '#ffffff',
  BLACK: '#1a1a2e',
  GRAY: '#666666',
  COIN_GOLD: '#ffd700',
  BADGE_PURPLE: '#9b59b6',

  // Relief / Cool
  COOL_BLUE: '#4fc3f7',
  COOL_MINT: '#80e8c0',
  RELIEF_GREEN: '#66ff66',
};

// Pixel font style (approximated with monospace)
export const PIXEL_FONT = {
  fontFamily: 'monospace',
  letterSpacing: 1,
};

export const SERVER_URL = 'http://localhost:3000';

export const SWIPE_THRESHOLD = 100; // pixels to register as a toss swipe
export const BUMP_THRESHOLD = 2.5;  // accelerometer magnitude to detect bump
