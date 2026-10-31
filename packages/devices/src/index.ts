import type { DeviceDriver, DriverFactory, DriverOptions } from './driver';
import { hikvisionFactory } from './hikvision/driver';
import { simulatorFactory } from './simulator/driver';
import type { DeviceConnection } from './types';

export * from './types';
export * from './driver';
export { HikvisionDriver } from './hikvision/driver';
export { SimulatedDriver } from './simulator/driver';
export { readOnly } from './readonly';

/** Drivers disponibles. Para sumar una marca: implementar DeviceDriver y registrarla acá. */
const factories = new Map<string, DriverFactory>(
  [hikvisionFactory, simulatorFactory].map((f) => [f.brand, f]),
);

export function listDrivers(opts: { includeSimulated?: boolean } = {}) {
  return [...factories.values()]
    .filter((f) => opts.includeSimulated || !f.simulated)
    .map(({ brand, label, simulated }) => ({ brand, label, simulated: !!simulated }));
}

export function createDriver(brand: string, connection: DeviceConnection, options?: DriverOptions): DeviceDriver {
  const factory = factories.get(brand);
  if (!factory) throw new Error(`No hay driver para la marca "${brand}"`);
  return factory.create(connection, options);
}
