// Prueba: muestra lo que ve la impresora (sin datos secretos). node sondeo.mjs
import { leerImpresora } from './ams.mjs';
try {
  const r = await leerImpresora(process.env.BAMBU_TOKEN);
  r.bandejas.forEach((b) => { if (b.rfid) b.rfid = b.rfid.slice(0, 4) + '…'; });
  console.log(JSON.stringify(r, null, 2));
} catch (e) { console.error('❌ ' + e.message); process.exit(1); }
process.exit(0);
