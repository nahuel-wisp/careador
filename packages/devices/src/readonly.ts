import { DeviceError, type DeviceDriver } from './driver';

const WRITE_METHODS = ['upsertPerson', 'deletePerson', 'setFace', 'deleteFace', 'setTime', 'openDoor'] as const;

/**
 * Envuelve un driver para que sólo pueda leer. Se usa en el entorno de pruebas
 * contra los equipos reales: puede leer personas y marcaciones, pero nunca escribir.
 */
export function readOnly(driver: DeviceDriver): DeviceDriver {
  return new Proxy(driver, {
    get(target, prop, receiver) {
      if ((WRITE_METHODS as readonly (string | symbol)[]).includes(prop) && prop in target) {
        return async () => {
          throw new DeviceError('Equipo en modo sólo lectura: no se envían cambios', 'read_only');
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
