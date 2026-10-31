import type { DeviceDriver, DriverFactory } from './driver';
import { hikvisionFactory } from './hikvision/driver';
import type { DeviceConnection } from './types';

export * from './types';
export * from './driver';
export { HikvisionDriver } from './hikvision/driver';

/** Drivers disponibles. Para sumar una marca: implementar DeviceDriver y registrarla acá. */
const factories = new Map<string, DriverFactory>([[hikvisionFactory.brand, hikvisionFactory]]);

export function listDrivers(): Array<Pick<DriverFactory, 'brand' | 'label'>> {
  return [...factories.values()].map(({ brand, label }) => ({ brand, label }));
}

export function createDriver(brand: string, connection: DeviceConnection): DeviceDriver {
  const factory = factories.get(brand);
  if (!factory) throw new Error(`No hay driver para la marca "${brand}"`);
  return factory.create(connection);
}
