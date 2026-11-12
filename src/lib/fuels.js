// Categorical slots follow the validated stacking order (gas, coal, nuclear, solar, wind, hydro, storage);
// "Other" is a neutral. Validated with the dataviz palette script (light surface): lightness band, chroma floor,
// adjacent-pair color-vision separation and normal-vision floor all pass. Contrast against the surface is below 3:1
// for gas, nuclear, solar and wind, so every chart also carries a legend and a table view.
export const FUEL_COLOR = {
  gas: '#e87e42', coal: '#623f85', nuclear: '#35aa76', solar: '#d9ae36',
  wind: '#5bc1d9', hydro: '#2b7cc0', storage: '#ce5d89', other: '#a3b0ba',
};

// Time coding used on the demand charts: cool is before ChatGPT's release, warm is after.
export const TIME = {
  cool: '#6f97b3', warm: '#e0903f',
  coolRamp: ['#c9d7e0', '#a9c0d0', '#86a6bd', '#5f87a5'], // 2019 to 2022, light to dark
  warmRamp: ['#f4cf9f', '#efb06c', '#e58c3a', '#c4651f'], // 2023 to 2026, light to dark
};

export const fuelLabel = (meta) => Object.fromEntries(meta.groups.map((g) => [g.key, g.label]));

// Retail-sales sectors (EIA sector ids). Validated as a four-slot categorical set on the light surface.
export const SECTOR_COLOR = { RES: '#009b95', COM: '#7b69c6', IND: '#dea143', TRA: '#da6a76', OTH: '#a3b0ba' };
