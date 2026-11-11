// Categorical slots follow the validated order (gas, coal, nuclear, solar, wind, hydro, storage); "Other" is neutral.
export const FUEL_COLOR = {
  gas: '#2a78d6', coal: '#eb6834', nuclear: '#1baf7a', solar: '#eda100',
  wind: '#e87ba4', hydro: '#008300', storage: '#6250d6', other: '#8a94a3',
};
export const fuelLabel = (meta) => Object.fromEntries(meta.groups.map((g) => [g.key, g.label]));
