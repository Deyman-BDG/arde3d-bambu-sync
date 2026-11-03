// Prueba rápida de las dos impresoras: bun logica.test.mjs
import assert from 'node:assert/strict';
import { procesar, aplicarAms, unirTareas, migrarRanuras } from './logica.mjs';

const D = 'SERIE_DAVID', A = 'SERIE_AARON';
const duenos = { [D]: 'david', [A]: 'aaron' };

// Quién mandó cada impresión
const t = (id, dev) => ({ id, deviceId: dev, status: 2, startTime: '2026-11-03T08:00:00Z', endTime: '2026-11-03T10:00:00Z', title: 'pieza', amsDetailMapping: [{ amsId: 0, slotId: 0, weight: 10 }] });
const u = unirTareas([
  { quien: 'david', tareas: [t(1, D), t(2, D), t(3, A)] },
  { quien: 'aaron', tareas: [t(2, D), t(4, A)] }
], duenos);
const envia = Object.fromEntries(u.map((x) => [x.id, x._envia]));
assert.deepEqual(envia, { 1: 'david', 2: 'aaron', 3: 'david', 4: 'aaron' });

// Ranuras antiguas sin serial pasan a la impresora de David
const ams = [{ slot: '0-0', filId: 'fD' }];
assert.equal(migrarRanuras(ams, D), true);
assert.equal(ams[0].serial, D);
ams.push({ slot: '0-0', serial: A, filId: 'fA' });

// Cada impresión descuenta del filamento de la ranura de SU impresora
const datos = {
  f3d: [{ id: 'fD', stock: 500 }, { id: 'fA', stock: 300, dueno: 'aaron' }],
  ams3d: ams, imp3d: [], ped3d: []
};
procesar(u, datos, '2026-11-01T00:00:00Z');
assert.equal(datos.f3d[0].stock, 480); // tareas 1 y 2 en la de David
assert.equal(datos.f3d[1].stock, 280); // tareas 3 y 4 en la de Aaron
assert.equal(datos.imp3d.find((r) => r.id === '2').enviadoPor, 'aaron');

// La misma bobina RFID en casa de cada uno = dos filamentos distintos
const bob = (rfid) => ({ slot: '0-1', vacia: false, tipo: 'PLA', subtipo: 'PLA Basic', color: '000000', codigo: 'GFA00', peso: 1000, restante: 50, rfid });
const d2 = { f3d: [], ams3d: [] };
const c = aplicarAms(d2, [{ serial: D, dueno: 'david', bandejas: [bob('u1')] }, { serial: A, dueno: 'aaron', bandejas: [bob('u2')] }], 1);
assert.equal(c.nuevos.length, 2);
assert.deepEqual(d2.f3d.map((f) => [f.dueno, f.stock]), [['david', 500], ['aaron', 500]]);
assert.equal(d2.ams3d.filter((a) => a.slot === '0-1').length, 2);

console.log('✅ logica OK');
