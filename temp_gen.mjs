import { buildPainelSyncMql5 } from './src/utils/mt5Bridge.ts';

const mql = buildPainelSyncMql5({
  endpointUrl: 'http://localhost:3000',
  token: 'tk_test123456789012',
  magicNumber: 12345,
  robotName: 'PainelSync EA',
});
console.log(mql);