import { createDriver, readOnly, type DeviceDriver } from '@careador/devices';
import type { AppContext } from '../app';
import type { devices } from '../db/schema';

type DeviceRow = typeof devices.$inferSelect;

/** ¿Este equipo puede recibir cambios en este entorno? */
export function isReadOnly(ctx: AppContext, device: DeviceRow): boolean {
  // El simulador nunca es real, así que en él se puede escribir siempre.
  if (device.brand === 'simulador') return device.readOnly;
  return device.readOnly || ctx.config.DEVICES_READ_ONLY;
}

/** Crea el driver del equipo aplicando las reglas del entorno (sólo lectura). */
export function driverFor(ctx: AppContext, device: DeviceRow): DeviceDriver {
  const driver = createDriver(
    device.brand,
    {
      host: device.host,
      username: device.username,
      password: ctx.secrets.decrypt(device.passwordEnc),
      https: device.https,
      utcOffset: device.utcOffset,
    },
    { dataDir: ctx.config.dataDir },
  );
  return isReadOnly(ctx, device) ? readOnly(driver) : driver;
}
