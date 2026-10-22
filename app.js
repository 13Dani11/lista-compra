/* LISTA COMPRA · lógica de la página (Supabase como base de datos) */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const lista = $('lista'), empty = $('empty'), msg = $('msg'), input = $('nuevo'), cant = $('cant'), btn = $('btnAdd');
const sug = $('sugerencias');
const MAX_FREC = 10, MAX_SUG = 10;

let sb = null;
let items = [], historial = [], compra = null, compraItems = [];
let editando = null, opciones = [], activa = -1, pestana = 'lista', ocupado = false, iniciado = false;

/* ---------- Utilidades ---------- */
function mostrarMsg(t){ msg.textContent = t; msg.hidden = !t; }
function clave(nombre){
  return nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}
function plural(n, s, p){ return n + ' ' + (n === 1 ? s : p); }
function pantalla(nombre){
  $('cargando').hidden = nombre !== 'cargando';
  $('pantallaLogin').hidden = nombre !== 'login';
  $('pantallaNoAutorizado').hidden = nombre !== 'noAutorizado';
  $('app').hidden = nombre !== 'app';
  if (nombre !== 'app'){ $('count').textContent = ''; $('flotante').hidden = true; }
}
function errorTexto(accion, error){
  console.error(accion, error);
  if (error && (error.code === '42501' || /row-level security/i.test(error.message || '')))
    return 'No tienes permiso para ' + accion + '. Comprueba que tu correo está en la lista de la familia.';
  return 'No se ha podido ' + accion + '. Revisa la conexión e inténtalo otra vez.';
}
function debounce(fn, ms){ let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

/* ---------- Carga de datos ---------- */
async function cargarItems(){
  const { data, error } = await sb.from('items').select('id,name,qty,created_at').order('created_at');
  if (error) return mostrarMsg(errorTexto('cargar la lista', error));
  items = data; render();
}
async function cargarFrecuentes(){
  const { data, error } = await sb.from('frecuentes').select('id,name,qty,count,last').order('last', { ascending: false }).limit(300);
  if (error) return console.error(error);
  historial = data; renderFrecuentes();
  if (document.activeElement === input) abrirSugerencias();
}
async function cargarCompra(){
  const { data, error } = await sb.from('compras').select('id,created_at').eq('estado', 'activa')
    .order('created_at', { ascending: false }).limit(1);
  if (error) return console.error(error);
  compra = data[0] || null;
  if (compra){
    const r = await sb.from('compra_items').select('id,name,qty,checked,orden').eq('compra_id', compra.id)
      .order('orden').order('created_at');
    if (r.error) return console.error(r.error);
    compraItems = r.data;
  } else compraItems = [];
  renderCompra();
}
const recargarItems = debounce(cargarItems, 150);
const recargarFrecuentes = debounce(cargarFrecuentes, 300);
const recargarCompra = debounce(cargarCompra, 150);

function escucharCambios(){
  sb.channel('lista-compra')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, recargarItems)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'frecuentes' }, recargarFrecuentes)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'compras' }, recargarCompra)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'compra_items' }, recargarCompra)
    .subscribe();
  // Al volver a la app en el móvil, refresca por si se perdió algún aviso
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible'){ cargarItems(); cargarFrecuentes(); cargarCompra(); }
  });
}

/* ---------- Pestañas ---------- */
function irA(p){
  pestana = p;
  $('tabLista').setAttribute('aria-selected', p === 'lista');
  $('tabCompra').setAttribute('aria-selected', p === 'compra');
  $('panelLista').hidden = p !== 'lista';
  $('panelCompra').hidden = p !== 'compra';
  try { localStorage.setItem('pestana', p); } catch(_){}
  renderFlotante();
}
$('tabLista').onclick = () => irA('lista');
$('tabCompra').onclick = () => irA('compra');

/* ---------- Lista ---------- */
function render(){
  // Si alguien está escribiendo una cantidad, no se reconstruye la lista (cerraría el teclado);
  // se vuelve a pintar al terminar de editar.
  const editor = editando && $('qty-' + editando);
  if (editor && document.activeElement === editor){
    $('count').textContent = items.length ? plural(items.length, 'producto', 'productos') : '';
    renderFrecuentes(); renderFlotante();
    return;
  }
  lista.replaceChildren();
  for (const it of items){
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'name'; n.textContent = it.name;
    li.append(n);
    if (editando === it.id){
      const e = document.createElement('input'); e.type = 'text'; e.className = 'qty-edit'; e.id = 'qty-' + it.id;
      e.value = it.qty || ''; e.maxLength = 20; e.placeholder = 'Cantidad'; e.setAttribute('aria-label', 'Cantidad de ' + it.name);
      let hecho = false;
      const guardar = async () => { if (hecho) return; hecho = true; editando = null; await cambiarCantidad(it, e.value.trim()); render(); };
      e.addEventListener('keydown', ev => {
        if (ev.key === 'Enter'){ ev.preventDefault(); guardar(); }
        if (ev.key === 'Escape'){ hecho = true; editando = null; render(); }
      });
      e.addEventListener('blur', guardar);
      li.append(e);
    } else {
      const q = document.createElement('button'); q.type = 'button';
      q.className = 'qty' + (it.qty ? ' set' : '');
      q.textContent = it.qty || '+ cant.';
      q.setAttribute('aria-label', it.qty ? 'Cambiar cantidad: ' + it.qty : 'Añadir cantidad');
      q.onclick = () => {
        editando = it.id;
        render();
        // El foco tiene que darse dentro del mismo toque: si no, el iPhone no abre el teclado
        const e = $('qty-' + it.id);
        if (e){ e.focus(); const n = e.value.length; try { e.setSelectionRange(n, n); } catch(_){} }
      };
      li.append(q);
    }
    const b = document.createElement('button'); b.className = 'del'; b.type = 'button';
    b.textContent = 'Quitar'; b.setAttribute('aria-label', 'Quitar ' + it.name);
    b.onclick = () => quitar(it.id, b);
    li.append(b);
    lista.append(li);
  }
  lista.hidden = items.length === 0;
  empty.hidden = items.length !== 0;
  $('count').textContent = items.length ? plural(items.length, 'producto', 'productos') : '';
  renderFrecuentes();
  renderFlotante();
  if (!sug.hidden) abrirSugerencias();
}

function renderFrecuentes(){
  const enLista = new Set(items.map(i => clave(i.name)));
  const top = [...historial].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, MAX_FREC);
  const chips = $('chips'); chips.replaceChildren();
  for (const f of top){
    const c = document.createElement('button'); c.type = 'button'; c.className = 'chip';
    c.textContent = f.name;
    const ya = enLista.has(f.id);
    c.disabled = ya;
    c.title = ya ? 'Ya está en la lista' : 'Añadir ' + f.name;
    c.onclick = () => anadir(f.name, f.qty || '');
    chips.append(c);
  }
  $('frecSec').hidden = top.length === 0;
}

/* ---------- Desplegable de recientes ---------- */
function abrirSugerencias(){
  const texto = clave(input.value.trim());
  const enLista = new Set(items.map(i => clave(i.name)));
  opciones = historial.filter(h => !texto || h.id.includes(texto)).slice(0, MAX_SUG);
  if (!opciones.length){ cerrarSugerencias(); return; }
  activa = -1;
  sug.replaceChildren();
  const cab = document.createElement('li'); cab.className = 'cab'; cab.setAttribute('role', 'presentation');
  cab.textContent = texto ? 'Coincidencias recientes' : 'Últimos añadidos';
  sug.append(cab);
  opciones.forEach((o, i) => {
    const li = document.createElement('li');
    li.className = 'opcion' + (enLista.has(o.id) ? ' ya' : '');
    li.id = 'op-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
    const n = document.createElement('span'); n.textContent = o.name;
    li.append(n);
    if (enLista.has(o.id)){ const e = document.createElement('span'); e.className = 'en'; e.textContent = 'ya en la lista'; li.append(e); }
    li.addEventListener('mousedown', ev => ev.preventDefault());
    li.addEventListener('click', () => elegir(i));
    sug.append(li);
  });
  sug.hidden = false; input.setAttribute('aria-expanded', 'true');
}
function cerrarSugerencias(){ sug.hidden = true; activa = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
function marcar(i){
  activa = i;
  [...sug.querySelectorAll('.opcion')].forEach((el, j) => el.setAttribute('aria-selected', j === i ? 'true' : 'false'));
  if (i >= 0){ input.setAttribute('aria-activedescendant', 'op-' + i); $('op-' + i).scrollIntoView({ block: 'nearest' }); }
}
async function elegir(i){
  const o = opciones[i]; if (!o) return;
  cerrarSugerencias();
  input.value = ''; cant.value = '';
  input.blur();
  const enLista = new Set(items.map(it => clave(it.name)));
  if (!enLista.has(o.id)) await anadir(o.name, o.qty || '');
}
input.addEventListener('focus', abrirSugerencias);
input.addEventListener('click', abrirSugerencias);
input.addEventListener('input', abrirSugerencias);
input.addEventListener('blur', () => setTimeout(cerrarSugerencias, 120));
input.addEventListener('keydown', ev => {
  if (sug.hidden){ if (ev.key === 'ArrowDown'){ abrirSugerencias(); ev.preventDefault(); } return; }
  if (ev.key === 'ArrowDown'){ ev.preventDefault(); marcar(Math.min(activa + 1, opciones.length - 1)); }
  else if (ev.key === 'ArrowUp'){ ev.preventDefault(); marcar(Math.max(activa - 1, 0)); }
  else if (ev.key === 'Enter' && activa >= 0){ ev.preventDefault(); elegir(activa); }
  else if (ev.key === 'Escape'){ cerrarSugerencias(); }
});

/* ---------- Pestaña Compra ---------- */
function renderCompra(){
  const hay = !!compra && compraItems.length > 0;
  $('compraVacia').hidden = hay;
  $('compraBox').hidden = !hay;
  const pend = compraItems.filter(p => !p.checked).length;
  const badge = $('badge');
  badge.hidden = !hay; badge.textContent = pend;
  if (!hay) return;
  const f = new Date(compra.created_at);
  $('compraFecha').textContent = 'Compra del ' + f.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  $('progreso').textContent = (compraItems.length - pend) + ' de ' + compraItems.length + ' en el carro';
  const ul = $('compraLista'); ul.replaceChildren();
  for (const p of compraItems){
    const li = document.createElement('li'); if (p.checked) li.className = 'hecho';
    const lab = document.createElement('label'); lab.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'cb-' + p.id; cb.checked = !!p.checked;
    cb.onchange = () => marcarProducto(p.id, cb.checked);
    const n = document.createElement('span'); n.className = 'name'; n.textContent = p.name;
    lab.append(cb, n); li.append(lab);
    if (p.qty){ const q = document.createElement('span'); q.className = 'qty set fija'; q.textContent = p.qty; li.append(q); }
    ul.append(li);
  }
}

async function marcarProducto(id, valor){
  compraItems = compraItems.map(p => p.id === id ? { ...p, checked: valor } : p);
  renderCompra();
  const { error } = await sb.from('compra_items').update({ checked: valor }).eq('id', id);
  if (error){ mostrarMsg(errorTexto('marcar el producto', error)); cargarCompra(); }
}

$('btnTerminar').onclick = async () => {
  if (!compra || ocupado) return;
  ocupado = true; $('btnTerminar').disabled = true;
  const { error } = await sb.rpc('terminar_compra', { p_compra: compra.id });
  ocupado = false; $('btnTerminar').disabled = false;
  if (error) return mostrarMsg(errorTexto('terminar la compra', error));
  mostrarMsg('');
  await Promise.all([cargarCompra(), cargarItems()]);
  irA('lista');
};

/* ---------- Botón Hacer compra ---------- */
function renderFlotante(){
  const visible = iniciado && pestana === 'lista' && items.length > 0;
  $('flotante').hidden = !visible;
  if (!visible) $('confirmar').hidden = true;
}
$('btnHacer').onclick = () => {
  $('confirmarTxt').textContent = (items.length === 1 ? 'Se moverá ' : 'Se moverán ') + plural(items.length, 'producto', 'productos') +
    ' a la pestaña Compra y la lista quedará vacía para todos.';
  $('confirmar').hidden = false;
  $('btnSi').focus();
};
$('btnNo').onclick = () => { $('confirmar').hidden = true; $('btnHacer').focus(); };
$('btnSi').onclick = async () => {
  if (ocupado || !items.length) return;
  ocupado = true; $('btnSi').disabled = true; $('btnHacer').disabled = true;
  const { error } = await sb.rpc('hacer_compra');
  ocupado = false; $('btnSi').disabled = false; $('btnHacer').disabled = false;
  if (error) return mostrarMsg(errorTexto('preparar la compra', error));
  $('confirmar').hidden = true;
  mostrarMsg('');
  await Promise.all([cargarItems(), cargarCompra()]);
  irA('compra');
};

/* ---------- Escritura en la lista ---------- */
async function anadir(name, qty){
  if (!name) return false;
  mostrarMsg('');
  const { error } = await sb.from('items').insert({ name, qty: qty || '' });
  if (error){ mostrarMsg(errorTexto('añadir el producto', error)); return false; }
  cargarItems();
  const k = clave(name);
  if (k) sb.rpc('registrar_frecuente', { p_id: k, p_name: name, p_qty: qty || '' })
    .then(({ error: e }) => { if (e) console.error(e); else cargarFrecuentes(); });
  return true;
}
async function cambiarCantidad(it, qty){
  if ((it.qty || '') === qty) return;
  it.qty = qty;
  const { error } = await sb.from('items').update({ qty }).eq('id', it.id);
  if (error){ mostrarMsg(errorTexto('cambiar la cantidad', error)); cargarItems(); }
}
async function quitar(id, b){
  b.disabled = true;
  const { error } = await sb.from('items').delete().eq('id', id);
  if (error){ b.disabled = false; return mostrarMsg(errorTexto('quitar el producto', error)); }
  items = items.filter(i => i.id !== id); render();
}

$('form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = input.value.trim();
  if (!name){ input.focus(); return; }
  btn.disabled = true;
  cerrarSugerencias();
  const ok = await anadir(name, cant.value.trim());
  if (ok){ input.value = ''; cant.value = ''; }
  btn.disabled = false;
  input.blur(); cant.blur();
});

/* ---------- Acceso ---------- */
$('formLogin').addEventListener('submit', async ev => {
  ev.preventDefault();
  const email = $('email').value.trim();
  const out = $('loginMsg');
  if (!email) return;
  $('btnLogin').disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
  $('btnLogin').disabled = false;
  out.hidden = false;
  if (error){
    out.className = 'msg';
    out.textContent = /rate|seconds/i.test(error.message || '')
      ? 'Has pedido varios enlaces seguidos. Espera un minuto y vuelve a intentarlo.'
      : 'No se ha podido enviar el enlace. Revisa el correo e inténtalo otra vez.';
  } else {
    out.className = 'ok';
    out.textContent = 'Listo. Abre el correo que te hemos enviado a ' + email + ' y pulsa el enlace desde este mismo dispositivo.';
  }
});
async function salir(){ await sb.auth.signOut(); location.reload(); }
$('btnSalir').onclick = salir;
$('btnSalirNoAut').onclick = salir;

async function iniciar(session){
  if (!session){ pantalla('login'); return; }
  const email = session.user.email || '';
  const { data, error } = await sb.from('miembros').select('email').limit(1);
  if (error || !data || !data.length){
    $('correoNoAut').textContent = email;
    pantalla('noAutorizado');
    return;
  }
  $('quien').textContent = email;
  pantalla('app');
  if (iniciado) return;
  iniciado = true;
  try { if (localStorage.getItem('pestana') === 'compra') irA('compra'); } catch(_){}
  await Promise.all([cargarItems(), cargarFrecuentes(), cargarCompra()]);
  escucharCambios();
}

/* ---------- Arranque ---------- */
(async () => {
  const cfg = window.CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL)){
    $('cargando').textContent = 'Falta configurar Supabase: rellena config.js con la URL y la anon key de tu proyecto.';
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((evento, session) => {
    // fuera del callback: Supabase recomienda no esperar otras llamadas dentro de él
    if (evento === 'SIGNED_IN') setTimeout(() => iniciar(session), 0);
    if (evento === 'SIGNED_OUT') pantalla('login');
  });
  const { data } = await sb.auth.getSession();
  iniciar(data.session);
})();

})();
