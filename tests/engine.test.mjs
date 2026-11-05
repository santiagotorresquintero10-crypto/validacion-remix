// Pruebas del motor de validación. Ejecutar:  node tests/engine.test.mjs
import {
  recordKey, issueSignature, CONFIRMABLE, VAL_FACT, CLASIF_CENTRAL, terceroFor,
  buildIndex, buildEquivalences, validateRecord, resolveField, normalize,
  rowsFromMatrix, STATUS, equivalenceId,
} from '../public/js/engine.js';

const REMIX = [
  { cliente: 'SANTIAGO TORRES', facturador: 'SANDRA MILENA LOPEZ', proveedor: 'NESTOR ANGEL CASTRO' },
  { cliente: 'SANTIAGO TORRES', facturador: 'AGROFAR', proveedor: 'HACIENDA LA ESPERANZA' },
  { cliente: 'CARNES DEL NORTE S.A.S.', facturador: 'AGROFAR', proveedor: 'NESTOR ANGEL CASTRO' },
  { cliente: 'CARNES DEL SUR', facturador: 'GANADOS EL RODEO', proveedor: 'JUAN CARLOS PÉREZ' },
  { cliente: 'Frigorífico Medellín', facturador: 'JUAN CARLOS PÉREZ', proveedor: 'SANTIAGO TORRES' },
  { cliente: 'INVERSIONES LA PRIMAVERA', facturador: 'GANADOS EL RODEO', proveedor: 'FINCA 1' },
  { cliente: 'INVERSIONES LA PRIMAVERA', facturador: 'GANADOS EL RODEO', proveedor: 'FINCA 2' },
];

const index = buildIndex(REMIX);
let eq = buildEquivalences([]);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra, null, 1) : ''); }
}
const v = (c, f, p) => validateRecord(index, eq, { cliente: c, facturador: f, proveedor: p });

console.log('\nNormalización');
check('mayúsculas/tildes/espacios', normalize('  santiago   tórres ') === 'SANTIAGO TORRES');
check('S.A.S. y S A S unifican', normalize('Carnes del Norte S.A.S.') === normalize('CARNES DEL NORTE S A S'));
check('puntuación irrelevante', normalize('Agrofar, S.A.S') === 'AGROFAR SAS');

console.log('\nCoincidencias exactas');
let r = v('santiago torres', 'Sandra Milena López', 'néstor ángel castro');
check('SANTIAGO TORRES = santiago torres → CORRECTO', r.status === STATUS.CORRECTO, r.status);
r = v('carnes del norte sas', 'AGROFAR', 'NESTOR ANGEL CASTRO');
check('Puntuación de S.A.S. → CORRECTO', r.status === STATUS.CORRECTO, r.status);
r = v('FRIGORIFICO MEDELLIN', 'JUAN CARLOS PEREZ', 'SANTIAGO TORRES');
check('Tildes en REMIX → CORRECTO', r.status === STATUS.CORRECTO, r.status);

console.log('\nTerceros: AGROFAR SAS / SANDRA MILENA LOPEZ OSORIO (tercera validación = No aplica)');
r = v('SANTIAGO TORRES', 'SANDRA MILENA LOPEZ OSORIO', 'NESTOR ANGEL CASTRO');
check('SANDRA MILENA LOPEZ OSORIO → CORRECTO, No aplica', r.status === STATUS.CORRECTO && r.valFacturar === VAL_FACT.NO_APLICA, [r.status, r.valFacturar]);
check('…clasificación = el tercero (no CENTRAL GANADERA)', r.clasificacion === 'SANDRA MILENA LOPEZ OSORIO', r.clasificacion);
check('…sin advertencias', r.warnings.length === 0, r.warnings);
check('…igual muestra Facturar a Nombre de de REMIX', r.facturarRemix === 'SANDRA MILENA LOPEZ', r.facturarRemix);
r = v('SANTIAGO TORRES', 'AGROFAR SAS', 'NESTOR ANGEL CASTRO');
check('AGROFAR SAS con Cliente+Proveedor relacionados → CORRECTO aunque REMIX diga otro Facturar a nombre de', r.status === STATUS.CORRECTO && r.valFacturar === VAL_FACT.NO_APLICA, [r.status, r.valFacturar]);
check('…y muestra el de REMIX (SANDRA MILENA LOPEZ) solo como consulta', r.facturarRemix === 'SANDRA MILENA LOPEZ', r.facturarRemix);
check('Mayúsculas y espacios no importan: «  agrofar   sas »', terceroFor(eq, '  agrofar   sas ') === 'AGROFAR SAS');
check('AGROFAR (equivalencia confirmada) también es tercero', terceroFor(eq, 'AGROFAR') === 'AGROFAR SAS');
check('Equivalencia NO se aplica a otras columnas', resolveField(index, eq, 'proveedor', 'AGROFAR SAS').status !== 'equivalencia');
r = v('SANTIAGO TORRES', 'AGROFAR SAS', 'JUAN CARLOS PEREZ');
check('Tercero: Cliente y Proveedor de filas distintas no se combinan → no es correcto', r.status === STATUS.NUEVO_PROVEEDOR, r.status);
r = v('SANTIAGO TORRES', 'SANDRA MILENA LOPES OSORIO', 'NESTOR ANGEL CASTRO');
check('Tercero mal escrito → CENTRAL GANADERA con aviso de parecido', r.clasificacion === CLASIF_CENTRAL && r.terceroParecido === 'SANDRA MILENA LOPEZ OSORIO', [r.clasificacion, r.terceroParecido]);

console.log('\nCENTRAL GANADERA (cualquier otro Cliente factura): tercera validación');
r = v('INVERSIONES LA PRIMAVERA', 'GANADOS EL RODEO', 'FINCA 1');
check('Coincide → CORRECTO y tercera validación Correcto', r.status === STATUS.CORRECTO && r.clasificacion === CLASIF_CENTRAL && r.valFacturar === VAL_FACT.CORRECTO, [r.status, r.clasificacion, r.valFacturar]);
r = v('inversiones la primavera', '  ganados   EL rodeo ', 'finca 1');
check('Ignora mayúsculas y espacios', r.valFacturar === VAL_FACT.CORRECTO, r.valFacturar);
r = v('SANTIAGO TORRES', 'GANADOS EL RODEO', 'NESTOR ANGEL CASTRO');
check('Diferente → Inconsistencia', r.valFacturar === VAL_FACT.INCONSISTENCIA && r.status === STATUS.RELACION, [r.valFacturar, r.status]);
check('…muestra el Facturar a Nombre de de REMIX', r.facturarRemix === 'SANDRA MILENA LOPEZ', r.facturarRemix);
check('…mensaje de siempre', r.warnings.some((w) => w.mensaje.includes('El Cliente y el Proveedor sí están relacionados en REMIX, pero no con este Facturar a nombre de.')));
r = v('CARNES DEL SUR', 'GANADOS EL RODEO', 'FINCA NUEVA QWERTY');
check('Sin relación en REMIX → Sin información (nunca Correcto)', r.valFacturar === VAL_FACT.SIN_INFO && r.status !== STATUS.CORRECTO, [r.valFacturar, r.status]);
r = v('INVERSIONES LA PRIMAVERA', '', 'FINCA 1');
check('Cliente factura vacío → CENTRAL GANADERA, Inconsistencia', r.clasificacion === CLASIF_CENTRAL && r.valFacturar === VAL_FACT.INCONSISTENCIA, [r.clasificacion, r.valFacturar]);
check('El valor original de Cliente factura no se modifica', v('x', '  Ganados  el Rodeo ', 'y').input.facturador === '  Ganados  el Rodeo ');

console.log('\nOrtografía, abreviaturas, identidad');
r = v('SANTIAGO TORRES', 'SANDRA MILENA LOPEZ', 'NESTO ANGEL CASTRO');
check('NESTO vs NESTOR → REVISAR', r.status === STATUS.REVISAR, r.status);
check('…etiqueta REVISAR ORTOGRAFÍA', r.fields.proveedor.label === 'REVISAR ORTOGRAFÍA', r.fields.proveedor.label);
check('…sugiere NESTOR ANGEL CASTRO', r.fields.proveedor.candidates[0].display === 'NESTOR ANGEL CASTRO');
check('…indica que la relación existiría', r.notes.some((n) => n.includes('sí existe')), r.notes);

let f = resolveField(index, eq, 'cliente', 'CARNES DEL CENTRO');
check('CARNES DEL CENTRO → VALIDAR IDENTIDAD (no correcto)', f.status === 'revisar' && f.candidates[0].kind === 'identidad', f);
f = resolveField(index, eq, 'cliente', 'CARNES DEL SUR');
check('CARNES DEL SUR es exacto (no se confunde con NORTE)', f.status === 'exacto' && f.matches[0] === 'CARNESDELSUR');
r = v('INVERSIONES LA PRIMAVERA', 'JUAN CARLOS PEREZ', 'SANTIAGO TORRES');
check('Central: Facturador+Proveedor de otro cliente → VALIDAR CLIENTE', r.status === STATUS.VALIDAR_CLIENTE, r.status);
check('…indica el cliente registrado (Frigorífico Medellín)', r.warnings[0].nombreRemix.includes('Frigorífico Medellín'), r.warnings);
r = v('CARNES DEL SUR', 'AGROFAR', 'NESTOR ANGEL CASTRO');
check('Tercero: CARNES DEL SUR no se confunde con CARNES DEL NORTE → no correcto', r.status !== STATUS.CORRECTO, r.status);

f = resolveField(index, eq, 'facturador', 'SANDRA LOPEZ');
check('Nombre incompleto SANDRA LOPEZ → REVISAR incompleto', f.status === 'revisar' && f.candidates[0].kind === 'incompleto', f.candidates?.[0]);
f = resolveField(index, eq, 'facturador', 'J C PEREZ');
check('Iniciales J C PEREZ → REVISAR, nunca correcto', f.status === 'revisar', f.status);
f = resolveField(index, eq, 'cliente', 'CARNES DEL NORTE');
check('Sin sigla SAS → REVISAR (no auto-correcto)', f.status === 'revisar' && f.candidates[0].kind === 'sufijo', f.candidates?.[0]);
f = resolveField(index, eq, 'proveedor', 'FINCA 3');
check('FINCA 3 no se corrige a FINCA 1/2', f.status !== 'exacto' && !(f.candidates || []).some((c) => c.kind === 'ortografia'), f);
f = resolveField(index, eq, 'facturador', 'TORRES SANTIAGO');
check('Columna equivocada: SANTIAGO TORRES no existe como Facturador', f.status !== 'exacto', f.status);

console.log('\nNo confundir columnas');
r = v('NESTOR ANGEL CASTRO', 'SANDRA MILENA LOPEZ', 'SANTIAGO TORRES');
check('Cliente y Proveedor invertidos → no es correcto', r.status !== STATUS.CORRECTO, r.status);
check('…Cliente marcado como no encontrado', r.fields.cliente.status === 'no_encontrado', r.fields.cliente.status);

console.log('\nNuevo proveedor / validar cliente');
r = v('SANTIAGO TORRES', 'SANDRA MILENA LOPEZ', 'FINCA 1');
check('Cliente+Facturador relacionados, proveedor de otra relación → NUEVO PROVEEDOR', r.status === STATUS.NUEVO_PROVEEDOR, r.status);
check('…lista los proveedores registrados', r.newProviderKnown.includes('NESTOR ANGEL CASTRO'), r.newProviderKnown);
r = v('SANTIAGO TORRES', 'SANDRA MILENA LOPEZ', 'PROVEEDOR QWERTY ZZZ');
check('Proveedor inexistente con Cliente+Facturador relacionados → NUEVO PROVEEDOR', r.status === STATUS.NUEVO_PROVEEDOR && r.warnings.length === 1, r);
r = v('SANTIAGO TORRES', 'SANDRA MILENA LOPEZ', 'NESTO ANGEL CASTRO');
check('Proveedor mal escrito sigue siendo REVISAR (no nuevo)', r.status === STATUS.REVISAR, r.status);
r = v('CLIENTE QWERTY ZZZ', 'AGROFAR', 'NESTOR ANGEL CASTRO');
check('Cliente inexistente con Facturador+Proveedor relacionados → VALIDAR CLIENTE', r.status === STATUS.VALIDAR_CLIENTE, r.status);
r = v('SANTIAGO TORRES', 'GANADOS EL RODEO', 'NESTOR ANGEL CASTRO');
check('Cliente+Proveedor relacionados con otro facturador → RELACIÓN NO REGISTRADA', r.status === STATUS.RELACION, r.status);

console.log('\nRelaciones (no combinar filas)');
r = v('INVERSIONES LA PRIMAVERA', 'GANADOS EL RODEO', 'JUAN CARLOS PEREZ');
check('Central: Cliente+Facturador de una fila y Proveedor de otra → no correcto (NUEVO PROVEEDOR)', r.status === STATUS.NUEVO_PROVEEDOR, r.status);
r = v('SANTIAGO TORRES', 'GANADOS EL RODEO', 'NESTOR ANGEL CASTRO');
check('Central: relación no registrada mantiene la advertencia literal', r.warnings.some((w) => w.mensaje.startsWith('ADVERTENCIA: RELACIÓN NO REGISTRADA EN REMIX')));
r = v('INVERSIONES LA PRIMAVERA', 'GANADOS EL RODEO', 'FINCA 2');
check('Relación válida múltiple → CORRECTO', r.status === STATUS.CORRECTO, r.status);
r = v('', 'GANADOS EL RODEO', 'FINCA 2');
check('Campo vacío → NO ENCONTRADO', r.status === STATUS.NO_ENCONTRADO, r.status);

console.log('\nDecisiones de identidad');
eq = buildEquivalences([{ field: 'proveedor', a: 'NESTO ANGEL CASTRO', b: 'NESTOR ANGEL CASTRO', status: 'rechazada' }]);
f = resolveField(index, eq, 'proveedor', 'NESTO ANGEL CASTRO');
check('Equivalencia descartada no vuelve a proponerse', !(f.candidates || []).some((c) => c.compact === 'NESTORANGELCASTRO'), f);
eq = buildEquivalences([{ field: 'proveedor', a: 'NESTO ANGEL CASTRO', b: 'NESTOR ANGEL CASTRO', status: 'aprobada' }]);
r = v('SANTIAGO TORRES', 'SANDRA MILENA LOPEZ', 'NESTO ANGEL CASTRO');
check('Equivalencia aprobada → CORRECTO (por equivalencia)', r.status === STATUS.CORRECTO && r.viaEquivalence, r.status);
eq = buildEquivalences([{ id: equivalenceId('facturador', 'AGROFAR SAS', 'AGROFAR'), field: 'facturador', a: 'AGROFAR SAS', b: 'AGROFAR', status: 'revertida' }]);
f = resolveField(index, eq, 'facturador', 'AGROFAR SAS');
check('Semilla revertida por admin deja de aplicar', f.status === 'revisar', f.status);
check('…y AGROFAR (sin SAS) deja de contarse como tercero', terceroFor(eq, 'AGROFAR') === null && terceroFor(eq, 'AGROFAR SAS') === 'AGROFAR SAS');
eq = buildEquivalences([{ field: 'proveedor', a: 'X', b: 'Y', status: 'propuesta' }]);
check('Propuesta pendiente no se aplica', resolveField(index, eq, 'proveedor', 'NESTO ANGEL CASTRO').status === 'revisar');
eq = buildEquivalences([]);

console.log('\nProveedor Central Ganadera');
r = v('SANTIAGO TORRES', 'AGROFAR', 'Central Ganadera S.A.');
check('Proveedor «Central Ganadera S.A.» → filtro propio', r.status === STATUS.CENTRAL, r.status);
check('…conserva el resultado de la validación', !!r.baseStatus && r.baseStatus !== STATUS.CENTRAL, r.baseStatus);
r = v('SANTIAGO TORRES', 'AGROFAR', 'CENTRAL GANADERA SA');
check('Variante sin puntos también', r.status === STATUS.CENTRAL);
check('No toca proveedores parecidos', v('SANTIAGO TORRES', 'AGROFAR', 'CENTRAL DE CARNES').status !== STATUS.CENTRAL);

console.log('\nLectura de Excel por encabezados');
let m = rowsFromMatrix([
  ['Informe diario'], [],
  ['  PROVEEDOR ', 'Facturador', 'cliente de  PLANTA'],
  ['NESTOR ANGEL CASTRO', 'SANDRA MILENA LOPEZ', 'SANTIAGO TORRES'],
  [], ['', '', ''],
]);
check('Encabezados con espacios/orden distinto', m.errors.length === 0 && m.rows.length === 1);
check('…mapea por nombre, no por posición', m.rows[0].cliente === 'SANTIAGO TORRES' && m.rows[0].proveedor === 'NESTOR ANGEL CASTRO');
m = rowsFromMatrix([
  ['Fecha', 'Cliente de planta', 'Kilos', 'Facturador', 'Proveedor', '', 'Kilos'],
  ['26/10/2026', 'A', '450', 'B', 'C', 'nota', '12'],
]);
check('Columnas adicionales se conservan en orden', JSON.stringify(m.extraHeaders) === JSON.stringify(['Fecha', 'Kilos', 'Columna 6', 'Kilos (2)']), m.extraHeaders);
check('…con sus valores por fila', JSON.stringify(m.rows[0].extra) === JSON.stringify(['26/10/2026', '450', 'nota', '12']) && m.rows[0].cliente === 'A', m.rows[0]);
console.log('\nREMIX: facturador = «Facturar a Nombre de»');
m = rowsFromMatrix([
  ['NIT', 'Cliente de planta', 'Facturador', 'Facturar a  Nombre  de', 'Proveedor', 'Ciudad'],
  ['900', 'SANTIAGO TORRES', 'OTRO NOMBRE', 'SANDRA MILENA LOPEZ', 'NESTOR ANGEL CASTRO', 'Medellín'],
], 'remix');
check('REMIX toma «Facturar a Nombre de», no «Facturador»', m.errors.length === 0 && m.rows[0].facturador === 'SANDRA MILENA LOPEZ', m);
check('…la columna «Facturador» del REMIX queda ignorada', !m.rows.some((r) => r.facturador === 'OTRO NOMBRE'));
m = rowsFromMatrix([['Cliente de planta', 'Facturador', 'Proveedor'], ['a', 'b', 'c']], 'remix');
check('REMIX sin «Facturar a Nombre de» → error claro', m.errors.length === 1 && m.errors[0].includes('Facturar a Nombre de'), m.errors);
m = rowsFromMatrix([['Cliente de planta', 'Facturar a Nombre de', 'Proveedor'], ['a', 'b', 'c']]);
check('Informe sigue exigiendo «Facturador»', m.errors.length === 1, m.errors);
m = rowsFromMatrix([['Cliente', 'Facturador', 'Proveedor'], ['a', 'b', 'c']]);
check('Encabezado ambiguo «Cliente» → error, no adivina', m.errors.length === 1);
m = rowsFromMatrix([['Cliente de planta', 'Facturador', 'Proveedor', 'Proveedor'], ['a', 'b', 'c', 'd']]);
check('Columna repetida → error', m.errors.length === 1);

console.log('\nFacturador (REMIX) — informativo');
{
  const R = [
    { cliente: 'ISRAEL MOLINA', facturador: 'SANDRA MILENA LOPEZ', facturadorRemix: 'COMERCIALIZADORA ABC', proveedor: 'GRANJA LA REAL' },
    { cliente: 'ISRAEL MOLINA', facturador: 'SANDRA MILENA LOPEZ', facturadorRemix: 'Comercializadora ABC', proveedor: 'PORCICOLA SIERRA' },
    { cliente: 'SUPER CARNES', facturador: 'AGROFAR', facturadorRemix: 'DISTRIBUIDORA XYZ', proveedor: 'MAXUL SAS' },
  ];
  const ix = buildIndex(R);
  const e0 = buildEquivalences([]);
  let x = validateRecord(ix, e0, { cliente: 'israel molina', facturador: 'SANDRA MILENA LOPEZ', proveedor: 'GRANJA LA REAL' });
  check('Relación correcta muestra el Facturador de esa fila REMIX', x.status === STATUS.CORRECTO && x.facturadorRemix === 'COMERCIALIZADORA ABC' && x.facturadorRemixBasis === 'relacion', x.facturadorRemix);
  check('…y muestra el Facturar a Nombre de de esa fila', x.facturarRemix === 'SANDRA MILENA LOPEZ', x.facturarRemix);
  x = validateRecord(ix, e0, { cliente: 'ISRAEL MOLINA', facturador: 'SANDRA MILENA LOPEZ', proveedor: 'MAXUL SAS' });
  check('Sin relación Cliente+Proveedor en REMIX: no inventa Facturador (REMIX)', x.facturadorRemix === '' && x.facturarRemix === '', x);
  x = validateRecord(ix, e0, { cliente: 'ISRAEL MOLINA', facturador: 'COMERCIALIZADORA ABC', proveedor: 'GRANJA LA REAL' });
  check('Escribir el Facturador(REMIX) en Facturar a nombre de NO valida', x.status !== STATUS.CORRECTO, x.status);
  const ixOld = buildIndex(REMIX);
  x = validateRecord(ixOld, e0, { cliente: 'SANTIAGO TORRES', facturador: 'SANDRA MILENA LOPEZ', proveedor: 'NESTOR ANGEL CASTRO' });
  check('REMIX sin columna Facturador → campo vacío, validación igual', x.status === STATUS.CORRECTO && x.facturadorRemix === '' && !ixOld.hasFacturadorRemix);
  const mm = rowsFromMatrix([['Cliente de planta', 'Facturador', 'Facturar a Nombre de', 'Proveedor'], ['A', 'FX', 'FN', 'P']], 'remix');
  check('Lectura REMIX: facturador=«Facturar a Nombre de», facturadorRemix=«Facturador»', mm.rows[0].facturador === 'FN' && mm.rows[0].facturadorRemix === 'FX', mm.rows[0]);
  const mi = rowsFromMatrix([['Lote', 'Cliente de planta', 'Facturador', 'Proveedor'], ['L1', 'A', 'FX', 'P']]);
  check('Lectura informe sin cambios: «Facturador» sigue siendo el campo validado', mi.rows[0].facturador === 'FX' && mi.rows[0].facturadorRemix === undefined);
}

{
  const v1 = rowsFromMatrix([['Cliente de planta', 'FACTURADOR REMIX', 'Facturar a Nombre de', 'Proveedor'], ['A', 'FX', 'FN', 'P']], 'remix');
  check('Variante «FACTURADOR REMIX» también se lee', v1.rows[0].facturadorRemix === 'FX' && v1.rows[0].facturador === 'FN', v1.rows[0]);
  const v2 = rowsFromMatrix([['Cliente de planta', 'Facturar a Nombre de', 'Proveedor', 'Nombre del facturador '], ['A', 'FN', 'P', 'FX']], 'remix');
  check('Variante «Nombre del facturador» también se lee', v2.rows[0].facturadorRemix === 'FX', v2.rows[0]);
  const v3 = rowsFromMatrix([['Cliente de planta', 'Facturar a Nombre de', 'Proveedor'], ['A', 'FN', 'P']], 'remix');
  check('Sin columna Facturador: «Facturar a Nombre de» nunca se toma como Facturador (REMIX)', v3.rows[0].facturadorRemix === undefined, v3.rows[0]);
}

console.log('\nInforme: «Cliente planta» y «Cliente factura»');
{
  let m1 = rowsFromMatrix([['Lote', 'NIT', 'Cliente planta', 'Cliente factura', 'Proveedor'], ['L1', '900', 'SANTIAGO TORRES', 'SANDRA MILENA LOPEZ', 'NESTOR ANGEL CASTRO']]);
  check('Cliente planta → Cliente de planta; Cliente factura → Facturador', m1.errors.length === 0 && m1.rows[0].cliente === 'SANTIAGO TORRES' && m1.rows[0].facturador === 'SANDRA MILENA LOPEZ', m1);
  check('…Lote y NIT quedan como columnas adicionales', JSON.stringify(m1.extraHeaders) === '["Lote","NIT"]', m1.extraHeaders);
  m1 = rowsFromMatrix([['Cliente de planta', 'Facturador', 'Proveedor'], ['A', 'B', 'C']]);
  check('Los nombres anteriores siguen funcionando', m1.errors.length === 0 && m1.rows[0].facturador === 'B');
  m1 = rowsFromMatrix([['Cliente planta', 'Cliente factura', 'Facturador', 'Proveedor'], ['A', 'B', 'OTRO', 'C']]);
  check('Si vienen «Cliente factura» y «Facturador», manda «Cliente factura»', m1.errors.length === 0 && m1.rows[0].facturador === 'B' && m1.extraHeaders.includes('Facturador'), m1);
  m1 = rowsFromMatrix([['Cliente planta', 'Cliente factura', 'Cliente factura', 'Proveedor'], ['A', 'B', 'X', 'C']]);
  check('«Cliente factura» repetida → error, no adivina', m1.errors.length === 1, m1.errors);
  m1 = rowsFromMatrix([['Cliente', 'Factura', 'Proveedor'], ['A', 'B', 'C']]);
  check('Mensaje de error usa los nombres nuevos', m1.errors[0]?.includes('«Cliente planta»') && m1.errors[0]?.includes('«Cliente factura»'), m1.errors);
}

console.log('\nTercero en Infocegan pero REMIX factura CENTRAL GANADERA');
{
  const R = [
    { cliente: 'IVAN ECHEVERRI PALACIO', facturador: 'SANDRA MILENA LOPEZ OSORIO', facturadorRemix: 'CENTRAL GANADERA', proveedor: 'CIPA' },
    { cliente: 'INVERSIONES MERCARNES', facturador: 'SANDRA MILENA LOPEZ OSORIO', facturadorRemix: 'SANDRA MILENA LOPEZ', proveedor: 'INVERSIONES JAIBU SAS' },
    { cliente: 'IVAN ECHEVERRI PALACIO', facturador: 'LA ESTRELLA S.A.S', facturadorRemix: 'CENTRAL GANADERA S.A.', proveedor: 'LA ESTRELLA S.A.S' },
  ];
  const ix = buildIndex(R), e0 = buildEquivalences([]);
  let x = validateRecord(ix, e0, { cliente: 'IVAN ECHEVERRI PALACIO', facturador: 'SANDRA MILENA LOPEZ OSORIO', proveedor: 'CIPA' });
  check('Facturador (REMIX) = CENTRAL GANADERA y Infocegan = SANDRA → RELACIÓN NO REGISTRADA', x.status === STATUS.RELACION, x.status);
  check('…con mensaje claro', x.warnings.some((w) => w.mensaje.includes('En REMIX está como CENTRAL GANADERA, no como SANDRA MILENA LOPEZ OSORIO.')), x.warnings);
  x = validateRecord(ix, e0, { cliente: 'IVAN ECHEVERRI PALACIO', facturador: 'AGROFAR SAS', proveedor: 'CIPA' });
  check('Igual con AGROFAR SAS', x.status === STATUS.RELACION, x.status);
  x = validateRecord(ix, e0, { cliente: 'INVERSIONES MERCARNES', facturador: 'SANDRA MILENA LOPEZ OSORIO', proveedor: 'INVERSIONES JAIBU SAS' });
  check('Facturador (REMIX) = SANDRA → sigue CORRECTO', x.status === STATUS.CORRECTO, x.status);
  x = validateRecord(ix, e0, { cliente: 'IVAN ECHEVERRI PALACIO', facturador: 'LA ESTRELLA S.A.S', proveedor: 'LA ESTRELLA S.A.S' });
  check('Central Ganadera en ambos lados → sin cambio (CORRECTO)', x.status === STATUS.CORRECTO, x.status);
}

console.log('\nControl Facturador (REMIX) AGROFAR / SANDRA');
{
  const R = [
    { cliente: 'C1', facturador: 'X', facturadorRemix: 'AGROFAR', proveedor: 'P1' },
    { cliente: 'C2', facturador: 'X', facturadorRemix: 'SANDRA MILENA LOPEZ', proveedor: 'P2' },
    { cliente: 'C3', facturador: 'X', facturadorRemix: 'COMERCIALIZADORA ABC', proveedor: 'P3' },
  ];
  const ix = buildIndex(R), e0 = buildEquivalences([]);
  const t = (c, f, p) => validateRecord(ix, e0, { cliente: c, facturador: f, proveedor: p });
  let x = t('C1', 'AGROFAR SAS', 'P1');
  check('REMIX AGROFAR + Infocegan AGROFAR SAS → CORRECTO', x.status === STATUS.CORRECTO, x.status);
  x = t('C1', 'SANDRA MILENA LOPEZ OSORIO', 'P1');
  check('REMIX AGROFAR + Infocegan SANDRA → RELACIÓN NO REGISTRADA', x.status === STATUS.RELACION, x.status);
  check('…mensaje «En REMIX está como AGROFAR, no como SANDRA MILENA LOPEZ OSORIO.»', x.warnings.some((w) => w.mensaje.endsWith('En REMIX está como AGROFAR, no como SANDRA MILENA LOPEZ OSORIO.')), x.warnings.map((w) => w.mensaje));
  x = t('C2', 'SANDRA MILENA LOPEZ OSORIO', 'P2');
  check('REMIX SANDRA MILENA LOPEZ + Infocegan SANDRA MILENA LOPEZ OSORIO → CORRECTO', x.status === STATUS.CORRECTO, x.status);
  x = t('C2', 'AGROFAR SAS', 'P2');
  check('REMIX SANDRA + Infocegan AGROFAR SAS → RELACIÓN NO REGISTRADA', x.status === STATUS.RELACION, x.status);
  x = t('C3', 'AGROFAR SAS', 'P3');
  check('REMIX con otro nombre (no reconocido) → no se controla', x.status === STATUS.CORRECTO, x.status);
}

console.log('\nConfirmación manual');
{
  const k1 = recordKey({ lote: '261027-1230', nit: '39178297', cliente: 'Israel de Jesús', facturador: 'SANDRA', proveedor: 'GRANJA' });
  const k2 = recordKey({ lote: '261027-1230', nit: '39178297', cliente: 'ISRAEL DE JESUS', facturador: 'sandra', proveedor: 'granja' });
  const k3 = recordKey({ lote: '261027-1231', nit: '39178297', cliente: 'ISRAEL DE JESUS', facturador: 'sandra', proveedor: 'granja' });
  check('Mismo registro aunque cambien tildes/mayúsculas', k1 === k2);
  check('Otro lote = otro registro', k1 !== k3);
  const a = v('SANTIAGO TORRES', 'AGROFAR', 'NESTOR ANGEL CASTRO');
  const b = v('santiago torres', 'Agrofar', 'Néstor Ángel Castro');
  check('Misma novedad → misma huella', issueSignature(a) === issueSignature(b));
  const c = v('SANTIAGO TORRES', 'AGROFAR', 'NESTO ANGEL CASTRO');
  check('Novedad distinta → huella distinta', issueSignature(a) !== issueSignature(c));
  check('Solo se confirman estados con novedad', CONFIRMABLE.has(STATUS.RELACION) && !CONFIRMABLE.has(STATUS.CORRECTO) && !CONFIRMABLE.has(STATUS.CENTRAL));
}

console.log('\nRendimiento');
const big = [];
for (let i = 0; i < 6000; i++) big.push({ cliente: `CLIENTE ${i} GANADERIA`, facturador: `FACTURADOR NUMERO ${i}`, proveedor: `HACIENDA ${i} LA LOMA` });
const bigIdx = buildIndex(big);
const t0 = Date.now();
for (let i = 0; i < 25; i++) validateRecord(bigIdx, eq, { cliente: `CLIENTE ${i} GANADERA`, facturador: `FACTURDOR NUMERO ${i}`, proveedor: `HACIENDA ${i} LA LOMA` });
const ms = Date.now() - t0;
check(`25 filas contra 6.000 relaciones en ${ms} ms (< 3000)`, ms < 3000);

console.log(`\n${pass} correctas, ${fail} fallidas\n`);
process.exit(fail ? 1 : 0);
