'use strict';

const THEME_IDS = ['graphite', 'coral', 'midnight', 'starlight', 'dusk', 'tide', 'linen', 'plum'];
const DEFAULT_THEME = 'midnight';

const THEMES = {
  graphite: {
    canvas: '#F4F5F7',
    surface: '#FFFFFF',
    surfaceSunken: '#FAFAFB',
    border: '#E2E4E8',
    borderStrong: '#C9CCD2',
    ink: '#14181C',
    inkMuted: '#5B6169',
    inkFaint: '#9297A0',
    accent: '#2A3F8F',
    accentTint: '#EBEEF9',
    accentHover: '#24357A',
    prod: '#1F6F4A',
    prodTint: '#E5F2EC',
    unprod: '#A63D40',
    unprodTint: '#F7E8E8',
    other: '#6B7280',
    otherTint: '#EDEEF0'
  },
  coral: {
    canvas: '#FBF6F3',
    surface: '#FFFFFF',
    surfaceSunken: '#F6EFEB',
    border: '#EDE1DA',
    borderStrong: '#D9C7BC',
    ink: '#2B2320',
    inkMuted: '#74655D',
    inkFaint: '#A89184',
    accent: '#C2542F',
    accentTint: '#FBEAE2',
    accentHover: '#A6461F',
    prod: '#2C7A52',
    prodTint: '#E7F3EC',
    unprod: '#B8483C',
    unprodTint: '#F8E9E5',
    other: '#7A6F66',
    otherTint: '#F0EBE6'
  },
  midnight: {
    canvas: '#0E1116',
    surface: '#161A21',
    surfaceSunken: '#1D222B',
    border: '#262C36',
    borderStrong: '#343B47',
    ink: '#E7E9EC',
    inkMuted: '#9BA1AC',
    inkFaint: '#656B76',
    accent: '#6B8AFA',
    accentTint: '#1B2340',
    accentHover: '#85A0FF',
    prod: '#3FA372',
    prodTint: '#12291F',
    unprod: '#E2685F',
    unprodTint: '#33191A',
    other: '#8890A0',
    otherTint: '#232733'
  },
  starlight: {
    canvas: '#F7F8FC',
    surface: '#FFFFFF',
    surfaceSunken: '#F0F2FA',
    border: '#E3E6F2',
    borderStrong: '#CBD0E6',
    ink: '#1B1E2E',
    inkMuted: '#5E6480',
    inkFaint: '#9BA0C0',
    accent: '#5B5FEF',
    accentTint: '#ECEDFC',
    accentHover: '#4A4ED9',
    prod: '#1E8F6B',
    prodTint: '#E3F5EE',
    unprod: '#C24870',
    unprodTint: '#FBEAF0',
    other: '#7076A0',
    otherTint: '#EEEFF7'
  },
  dusk: {
    canvas: '#2B2A33',
    surface: '#34333D',
    surfaceSunken: '#3C3B46',
    border: '#454450',
    borderStrong: '#54525F',
    ink: '#EDEBF0',
    inkMuted: '#A9A6B4',
    inkFaint: '#726F7D',
    accent: '#C98A4B',
    accentTint: '#3D3226',
    accentHover: '#DE9C5C',
    prod: '#4E9A72',
    prodTint: '#23342B',
    unprod: '#C15C55',
    unprodTint: '#3A2624',
    other: '#8D899A',
    otherTint: '#322F3A'
  },
  tide: {
    canvas: '#0F181E',
    surface: '#17232B',
    surfaceSunken: '#1E2E38',
    border: '#2B3C47',
    borderStrong: '#415663',
    ink: '#E4EEF3',
    inkMuted: '#B0C2CD',
    inkFaint: '#8198A6',
    accent: '#76BFD4',
    accentTint: '#1D3540',
    accentHover: '#94D2E3',
    prod: '#61B98F',
    prodTint: '#1A352A',
    unprod: '#ED8B81',
    unprodTint: '#40272A',
    other: '#9AABBA',
    otherTint: '#293641'
  },
  linen: {
    canvas: '#F4F0E8',
    surface: '#FFFCF6',
    surfaceSunken: '#EEE8DC',
    border: '#DDD5C8',
    borderStrong: '#BFB4A0',
    ink: '#302D27',
    inkMuted: '#625C51',
    inkFaint: '#7F7669',
    accent: '#7A5B27',
    accentTint: '#F0E5CF',
    accentHover: '#65471C',
    prod: '#346F53',
    prodTint: '#E6EFE4',
    unprod: '#B1433D',
    unprodTint: '#F7E5DF',
    other: '#6F6B62',
    otherTint: '#EAE6DE'
  },
  plum: {
    canvas: '#1B1720',
    surface: '#251F2C',
    surfaceSunken: '#302838',
    border: '#3D3347',
    borderStrong: '#574962',
    ink: '#F0E9F4',
    inkMuted: '#C5B8CE',
    inkFaint: '#9C8AA8',
    accent: '#BAA0DB',
    accentTint: '#3A2E49',
    accentHover: '#CFB9E9',
    prod: '#6BB392',
    prodTint: '#21352D',
    unprod: '#EB8B92',
    unprodTint: '#402730',
    other: '#AA9CB6',
    otherTint: '#342D3F'
  }
};

function normalizeTheme(value) {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEMES, value)) {
    return value;
  }
  if (value === true) return 'midnight';
  if (value === false) return 'graphite';
  return DEFAULT_THEME;
}

function canvasForTheme(value) {
  return THEMES[normalizeTheme(value)].canvas;
}

function titleBarOverlayForTheme(value) {
  const theme = THEMES[normalizeTheme(value)];
  return {
    color: theme.canvas,
    symbolColor: theme.ink,
    height: 32
  };
}

function isDarkTheme(value) {
  const id = normalizeTheme(value);
  return id === 'midnight' || id === 'dusk' || id === 'tide' || id === 'plum';
}

module.exports = {
  THEME_IDS,
  DEFAULT_THEME,
  THEMES,
  normalizeTheme,
  canvasForTheme,
  titleBarOverlayForTheme,
  isDarkTheme
};
