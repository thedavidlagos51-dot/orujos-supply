/* Orujos Supply: client application. Authorization is enforced by Supabase RLS. */
const root = document.querySelector('#app');
const cfg = window.ORUJOS_CONFIG || {};
const configured = cfg.supabaseUrl?.startsWith('https://') && cfg.supabasePublishableKey?.startsWith('sb_');
const db = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;
let session, profile, branches = [], areas = [], categories = [], products = [], currentRequest;
const HNL = new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' });
const money = value => HNL.format(Number(value || 0));
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const date = value => new Date(value).toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' });
const admin = () => profile?.role === 'ADMIN';
const error = msg => `<div class="notice error">${esc(msg)}</div>`;
async function query(builder) { const { data, error } = await builder; if (error) throw error; return data; }

function setupNeeded() {
  root.innerHTML = `<section class="login stack"><img class="brand-logo" src="/logo-orujos.png" alt="Orujos Supply"><h1>Supply</h1>${error('Falta configurar la conexión con Supabase.')}<p>Edite <code>public/config.js</code> con la URL y la clave publishable del proyecto antes de publicar.</p></section>`;
}
function login() {
  root.innerHTML = `<section class="login stack"><img class="brand-logo" src="/logo-orujos.png" alt="Orujos Supply"><div class="muted">Supply · solicitudes internas</div><h1>Iniciar sesión</h1><div id="form-error"></div><label>Correo<input id="email" type="email" autocomplete="email" required></label><label>Contraseña<input id="password" type="password" autocomplete="current-password" required></label><button id="signin">Entrar</button></section>`;
  document.querySelector('#signin').onclick = async () => {
    try { const { error: e } = await db.auth.signInWithPassword({ email: email.value, password: password.value }); if (e) throw e; await boot(); }
    catch (e) { document.querySelector('#form-error').innerHTML = error('No fue posible iniciar sesión. Verifique sus datos.'); }
  };
}
async function boot() {
  if (!configured) return setupNeeded();
  const { data } = await db.auth.getSession(); session = data.session;
  if (!session) return login();
  try {
    profile = await query(db.from('profiles').select('id, full_name, role, branch_id, area_id, active').eq('id', session.user.id).single());
    if (!profile.active) throw new Error('Usuario inactivo');
    [branches, areas, categories] = await Promise.all([
      query(db.from('branches').select('*').eq('active', true).order('name')),
      query(db.from('areas').select('*').eq('active', true).order('name')),
      query(db.from('categories').select('*').eq('active', true).order('name'))
    ]);
    await loadProducts(); shell('home');
  } catch (e) { await db.auth.signOut(); root.innerHTML = `<section class="login stack">${error('Tu usuario todavía no está autorizado. Pide al administrador que cree tu perfil.')}<button onclick="location.reload()">Volver</button></section>`; }
}
async function loadProducts() {
  let q = db.from('products').select('*, categories(name), product_scopes(branch_id,area_id)').order('name');
  if (!admin()) q = q.eq('active', true);
  products = await query(q);
}
function shell(view) {
  root.innerHTML = `<div class="shell"><header class="top"><div><div class="brand">ORUJOS</div><span class="muted">Supply · ${esc(profile.full_name)}</span></div><button class="secondary" id="logout">Salir</button></header><nav class="nav"><button data-view="home">Inicio</button><button data-view="request">Nueva solicitud</button><button data-view="history">Historial</button>${admin() ? '<button data-view="products">Productos</button><button data-view="settings">Configuración</button>' : ''}</nav><section id="content"></section></div>`;
  document.querySelector('#logout').onclick = async () => { await db.auth.signOut(); login(); };
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => shell(b.dataset.view));
  ({ home, request: requestView, history, products: productsView, settings }[view])();
}
async function home() {
  if (!admin()) { content.innerHTML = `<section class="panel hero"><h1>Hola, ${esc(profile.full_name)}</h1><p class="muted">Registra existencias y prepara tu solicitud de suministros.</p><button onclick="shell('request')">Crear solicitud</button></section>`; return; }
  const requests = await query(db.from('supply_requests').select('id,status,total,created_at,branch:branches(name), items:supply_request_items(category_name,requested_qty,subtotal)').order('created_at', { ascending: false }));
  const today = new Date().toDateString(); const sum = rows => rows.reduce((n, r) => n + Number(r.total || 0), 0);
  const pending = requests.filter(r => ['ENVIADA', 'EN_REVISION'].includes(r.status));
  const byBranch = Object.values(requests.reduce((a, r) => { const n = r.branch?.name || 'Sin sucursal'; (a[n] ||= 0); a[n] += Number(r.total); return a; }, {}));
  const branchEntries = Object.entries(requests.reduce((a, r) => { const n = r.branch?.name || 'Sin sucursal'; a[n] = (a[n] || 0) + Number(r.total); return a; }, {}));
  const top = Object.entries(requests.flatMap(r => r.items || []).reduce((a, i) => { a[i.product_name] = (a[i.product_name] || 0) + Number(i.requested_qty); return a; }, {})).sort((a,b) => b[1]-a[1]).slice(0,5);
  content.innerHTML = `<section class="grid"><article class="card">Pendientes<strong>${pending.length}</strong></article><article class="card">Recibidas hoy<strong>${requests.filter(r => new Date(r.created_at).toDateString() === today).length}</strong></article><article class="card">Aprobadas<strong>${requests.filter(r => r.status === 'APROBADA').length}</strong></article><article class="card">Total solicitado<strong>${money(sum(requests))}</strong></article></section><section class="panel"><h2>Compras por sucursal</h2>${branchEntries.map(([n,v]) => `<p class="line"><span>${esc(n)}</span><strong>${money(v)}</strong></p>`).join('') || '<p class="muted">Aún no hay solicitudes.</p>'}</section><section class="panel"><h2>Productos más solicitados</h2>${top.map(([n,v],i) => `<p class="line"><span>${i+1}. ${esc(n)}</span><strong>${v}</strong></p>`).join('') || '<p class="muted">Aún no hay solicitudes.</p>'}</section>`;
}
function scoped(p, branchId, areaId) { return p.product_scopes?.some(s => s.branch_id === Number(branchId) && s.area_id === Number(areaId)); }
function requestView() {
  const assignedBranch = branches.find(x => x.id === profile.branch_id), assignedArea = areas.find(x => x.id === profile.area_id);
  if (!admin() && (!assignedBranch || !assignedArea)) { content.innerHTML = error('No tienes sucursal y área asignadas.'); return; }
  const filters = admin() ? `<div class="row"><label>Sucursal<select id="branch">${branches.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>Área<select id="area">${areas.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label></div>` : `<p class="muted">${esc(assignedBranch.name)} · ${esc(assignedArea.name)}</p>`;
  content.innerHTML = `<section class="panel"><h1>Nueva solicitud</h1>${filters}<div id="request-products"></div><label>Observaciones<textarea id="notes" rows="2" placeholder="Opcional"></textarea></label><div class="total">TOTAL <span id="request-total">${money(0)}</span></div><button id="review-request">Revisar y enviar</button></section>`;
  const render = () => {
    const branchId = admin() ? branch.value : profile.branch_id, areaId = admin() ? area.value : profile.area_id;
    const visible = products.filter(p => scoped(p, branchId, areaId));
    document.querySelector('#request-products').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Unidad</th><th>Existencia</th><th>A solicitar</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${visible.map(p => `<tr data-product="${p.id}"><td>${esc(p.name)}<small>${esc(p.code)}</small></td><td>${esc(p.unit)}</td><td><input class="physical" type="number" min="0" step="0.01" value="0"></td><td><input class="requested" type="number" min="0" step="0.01" value="0"></td><td>${money(p.unit_price)}</td><td class="subtotal">${money(0)}</td></tr>`).join('')}</tbody></table></div>`;
    document.querySelectorAll('.requested').forEach(i => i.oninput = refreshTotal);
  };
  const refreshTotal = () => { let total = 0; document.querySelectorAll('tr[data-product]').forEach(row => { const p = products.find(x => x.id === Number(row.dataset.product)); const q = Number(row.querySelector('.requested').value || 0); const s = p.unit_price * q; row.querySelector('.subtotal').textContent = money(s); total += s; }); requestTotal.textContent = money(total); };
  render(); if (admin()) { branch.onchange = area.onchange = () => { render(); refreshTotal(); }; }
  reviewRequest.onclick = () => submitRequest();
}
async function submitRequest() {
  const selected = [...document.querySelectorAll('tr[data-product]')].map(row => ({ product_id: Number(row.dataset.product), physical_qty: Number(row.querySelector('.physical').value || 0), requested_qty: Number(row.querySelector('.requested').value || 0) })).filter(x => x.requested_qty > 0);
  if (!selected.length || selected.some(x => x.physical_qty < 0 || x.requested_qty < 0)) return alert('Ingresa cantidades válidas mayores o iguales a cero.');
  const total = selected.reduce((sum, x) => sum + Number(products.find(p => p.id === x.product_id).unit_price) * x.requested_qty, 0);
  if (!confirm(`Está a punto de enviar una solicitud por ${money(total)}. ¿Desea continuar?`)) return;
  try {
    const branchId = admin() ? Number(branch.value) : profile.branch_id, areaId = admin() ? Number(area.value) : profile.area_id;
    const request = await query(db.from('supply_requests').insert({ branch_id: branchId, area_id: areaId, user_id: session.user.id, notes: notes.value || null }).select().single());
    await query(db.from('supply_request_items').insert(selected.map(x => ({ ...x, request_id: request.id }))));
    await query(db.rpc('finalize_supply_request', { p_request_id: request.id }));
    alert('Solicitud enviada correctamente.'); shell('history');
  } catch (e) { alert(e.message || 'No se pudo enviar la solicitud.'); }
}
async function history() {
  let q = db.from('supply_requests').select('*, branch:branches(name), area:areas(name), requester:profiles!supply_requests_user_id_fkey(full_name)').order('created_at', { ascending: false });
  if (!admin()) q = q.eq('user_id', session.user.id);
  const rows = await query(q);
  content.innerHTML = `<section class="panel"><h1>${admin() ? 'Solicitudes recibidas' : 'Mis solicitudes'}</h1><div class="table-wrap"><table><thead><tr><th>Número</th><th>Fecha</th><th>Sucursal / área</th><th>Solicitante</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.number || 'Borrador')}</td><td>${date(r.created_at)}</td><td>${esc(r.branch?.name)}<small>${esc(r.area?.name)}</small></td><td>${esc(r.requester?.full_name)}</td><td>${money(r.total)}</td><td><span class="badge">${esc(r.status.replace('_',' '))}</span></td><td><button class="secondary" data-id="${r.id}">Ver</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No hay solicitudes.</td></tr>'}</tbody></table></div></section>`;
  content.querySelectorAll('[data-id]').forEach(b => b.onclick = () => requestDetail(b.dataset.id));
}
async function requestDetail(id) {
  const r = await query(db.from('supply_requests').select('*, branch:branches(name), area:areas(name), requester:profiles!supply_requests_user_id_fkey(full_name), items:supply_request_items(*)').eq('id', id).single()); currentRequest = r;
  content.innerHTML = `<section class="panel"><button class="secondary" onclick="shell('history')">← Volver</button><h1>${esc(r.number)}</h1><p>${esc(r.branch?.name)} · ${esc(r.area?.name)} · ${esc(r.requester?.full_name)}<br><span class="badge">${esc(r.status.replace('_',' '))}</span></p><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Existencia</th><th>Solicitado</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${r.items.map(i => `<tr><td>${esc(i.product_name)}<small>${esc(i.code)}</small></td><td>${i.physical_qty} ${esc(i.unit)}</td><td>${i.requested_qty}</td><td>${money(i.unit_price)}</td><td>${money(i.subtotal)}</td></tr>`).join('')}</tbody></table></div><div class="total">TOTAL <span>${money(r.total)}</span></div>${admin() ? `<div class="row"><label>Estado<select id="status">${['EN_REVISION','APROBADA','MODIFICADA','RECHAZADA','COMPRADA','CERRADA'].map(s => `<option ${r.status===s?'selected':''}>${s}</option>`).join('')}</select></label><button id="save-status">Actualizar</button><button class="secondary" id="excel">Excel</button><button class="secondary" id="pdf">PDF</button></div>` : ''}</section>`;
  if (admin()) { saveStatus.onclick = () => updateStatus(r.id); excel.onclick = exportExcel; pdf.onclick = exportPdf; }
}
async function updateStatus(id) { try { await query(db.from('supply_requests').update({ status: status.value, reviewed_at: new Date().toISOString(), reviewed_by: session.user.id }).eq('id', id)); alert('Estado actualizado.'); requestDetail(id); } catch(e) { alert(e.message); } }
function exportExcel() { const r = currentRequest, rows = r.items.map(i => ({ Código:i.code, Producto:i.product_name, Categoría:i.category_name, Unidad:i.unit, Existencia:i.physical_qty, Solicitado:i.requested_qty, 'Precio unitario':Number(i.unit_price), Subtotal:Number(i.subtotal) })); rows.push({ Producto:'TOTAL GENERAL', Subtotal:Number(r.total) }); const wb = XLSX.utils.book_new(), ws = XLSX.utils.json_to_sheet(rows); XLSX.utils.sheet_add_aoa(ws, [[`ORUJOS · SOLICITUD DE SUMINISTROS ${r.number}`], [`Sucursal: ${r.branch.name} · Área: ${r.area.name} · Solicitante: ${r.requester.full_name}`]], { origin:'A1' }); XLSX.utils.book_append_sheet(wb, ws, 'Solicitud'); XLSX.writeFile(wb, `${r.number}.xlsx`); }
function exportPdf() { const r = currentRequest, { jsPDF } = window.jspdf, doc = new jsPDF(); doc.setFontSize(20); doc.text('ORUJOS', 14, 18); doc.setFontSize(11); doc.text(`Solicitud: ${r.number}`, 14, 28); doc.text(`Sucursal: ${r.branch.name} · Área: ${r.area.name}`, 14, 35); let y=47; doc.text('Producto',14,y); doc.text('Cantidad',115,y); doc.text('Precio',145,y); doc.text('Subtotal',175,y); y+=7; r.items.forEach(i => { if(y>275){doc.addPage();y=20;} doc.text(String(i.product_name).slice(0,36),14,y); doc.text(String(i.requested_qty),115,y); doc.text(money(i.unit_price),145,y); doc.text(money(i.subtotal),175,y); y+=7; }); doc.setFontSize(13); doc.text(`TOTAL: ${money(r.total)}`, 145, y+10); doc.save(`${r.number}.pdf`); }
async function productsView() {
  await loadProducts();
  content.innerHTML = `<section class="panel"><div class="line"><div><h1>Productos</h1><p class="muted">Crea, modifica, activa o desactiva el catálogo.</p></div><button id="new-product">+ Agregar producto</button></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Unidad</th><th>Precio</th><th>Áreas asignadas</th><th>Estado</th><th></th></tr></thead><tbody>${products.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}<small>${esc(p.supplier || '')}</small></td><td>${esc(p.categories?.name || '—')}</td><td>${esc(p.unit)}</td><td>${money(p.unit_price)}</td><td>${p.product_scopes.map(s => { const b=branches.find(x=>x.id===s.branch_id)?.name||''; const a=areas.find(x=>x.id===s.area_id)?.name||''; return esc(`${b} · ${a}`); }).join('<br>') || '<span class="muted">Sin asignar</span>'}</td><td>${p.active ? '<span class="badge">Activo</span>' : '<span class="badge">Inactivo</span>'}</td><td><button class="secondary edit-product" data-id="${p.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No hay productos.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#new-product').onclick = () => productForm();
  content.querySelectorAll('.edit-product').forEach(b => b.onclick = () => productForm(products.find(p => p.id === Number(b.dataset.id))));
}
function productForm(p = null) {
  const selected = new Set((p?.product_scopes || []).map(s => `${s.branch_id}:${s.area_id}`));
  const scopeOptions = branches.flatMap(b => areas.map(a => `<label class="check"><input type="checkbox" name="scope" value="${b.id}:${a.id}" ${selected.has(`${b.id}:${a.id}`) ? 'checked' : ''}> ${esc(b.name)} · ${esc(a.name)}</label>`)).join('');
  content.innerHTML = `<section class="panel"><button class="secondary" id="back-products">← Volver</button><h1>${p ? 'Editar producto' : 'Agregar producto'}</h1><div id="product-error"></div><div class="row"><label>Código<input id="p-code" value="${esc(p?.code || '')}" required></label><label>Nombre<input id="p-name" value="${esc(p?.name || '')}" required></label></div><div class="row"><label>Categoría<select id="p-category"><option value="">Sin categoría</option>${categories.map(c => `<option value="${c.id}" ${p?.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Subcategoría<input id="p-subcategory" value="${esc(p?.subcategory || '')}"></label><label>Unidad<input id="p-unit" value="${esc(p?.unit || '')}" placeholder="Ej.: Galón" required></label></div><div class="row"><label>Precio unitario (L)<input id="p-price" type="number" min="0" step="0.01" value="${p?.unit_price ?? ''}" required></label><label>Proveedor<input id="p-supplier" value="${esc(p?.supplier || '')}"></label><label>Estado<select id="p-active"><option value="true" ${p?.active !== false?'selected':''}>Activo</option><option value="false" ${p?.active === false?'selected':''}>Inactivo</option></select></label></div><label>Observaciones<textarea id="p-notes" rows="2">${esc(p?.notes || '')}</textarea></label><h2>Visible para estas sucursales y áreas</h2><p class="muted">Los encargados solo podrán ver los productos asignados a su misma sucursal y área.</p><div class="scopes">${scopeOptions}</div><div class="row"><button id="save-product">Guardar producto</button>${p ? `<button class="secondary" id="toggle-product">${p.active ? 'Desactivar' : 'Activar'}</button>` : ''}</div></section>`;
  document.querySelector('#back-products').onclick = () => shell('products');
  document.querySelector('#save-product').onclick = () => saveProductForm(p?.id);
  if (p) document.querySelector('#toggle-product').onclick = () => {
    document.querySelector('#p-active').value = p.active ? 'false' : 'true';
    saveProductForm(p.id);
  };
}
async function saveProductForm(id) {
  const field = selector => document.querySelector(selector);
  const payload = { code:field('#p-code').value.trim(), name:field('#p-name').value.trim(), category_id:field('#p-category').value ? Number(field('#p-category').value) : null, subcategory:field('#p-subcategory').value.trim() || null, unit:field('#p-unit').value.trim(), unit_price:Number(field('#p-price').value), supplier:field('#p-supplier').value.trim() || null, notes:field('#p-notes').value.trim() || null, active:field('#p-active').value === 'true' };
  const scopes = [...document.querySelectorAll('input[name="scope"]:checked')].map(x => { const [branch_id, area_id] = x.value.split(':').map(Number); return { branch_id, area_id }; });
  const productError = field('#product-error');
  if (!payload.code || !payload.name || !payload.unit || Number.isNaN(payload.unit_price) || payload.unit_price < 0) { productError.innerHTML = error('Completa código, nombre, unidad y un precio válido.'); return; }
  if (!scopes.length) { productError.innerHTML = error('Asigna el producto al menos a una sucursal y área.'); return; }
  try { const saved = id ? await query(db.from('products').update(payload).eq('id', id).select().single()) : await query(db.from('products').insert(payload).select().single()); await query(db.from('product_scopes').delete().eq('product_id', saved.id)); await query(db.from('product_scopes').insert(scopes.map(s => ({ ...s, product_id:saved.id })))); alert('Producto guardado.'); shell('products'); } catch (e) { productError.innerHTML = error(e.message.includes('products_code_key') ? 'Ese código ya existe.' : e.message); }
}
function settings() { content.innerHTML = `<section class="panel"><h1>Configuración</h1><p>Gestiona usuarios, sucursales, áreas y categorías desde Supabase. La seguridad se aplica directamente en la base de datos.</p><p class="muted">Usa el archivo <code>supabase/schema.sql</code> para instalar la estructura y crear usuarios mediante Authentication.</p></section>`; }
window.shell = shell; boot();
