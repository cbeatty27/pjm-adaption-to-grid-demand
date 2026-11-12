import { mountMap } from './map.js';

export function mount(root, data, us) {
  return mountMap(root, data, { scope: 'us', units: us.units, snapshot: data.meta.plants_us.snapshot_period, statusNames: us.statusNames, retired: data.retired });
}
