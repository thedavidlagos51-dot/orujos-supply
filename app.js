(() => {
  'use strict';
  const cfg = window.ORUJOS_CONFIG;
  const root = document.querySelector('#app');
  if (!cfg?.supabaseUrl || !cfg?.supabasePublishableKey || cfg.supabaseUrl.includes('TU-PROYECTO')) {
    root.innerHTML = '<main class="center"><h1>ORUJOS <span>Supply</span></h1><p>Falta configurar la conexión con Supabase.</p></main>';
    return;
  }
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
  const money = n => new Intl.NumberFormat('es-HN',{style:'currency',currency:'HNL',minimumFractionDigits:2}).format(Number(n || 0));
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let profile = null;
  let selectedArea = '';

  async function getProfile() {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return null;
    const { data, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  function notice(message, kind = 'ok') { document.querySelector('#notice')?.replaceChildren(Object.assign(document.createElement('div'), { className: kind, textContent: message })); }
  function shell(title, body) {
    root.innerHTML = `<header><div><b>ORUJOS</b> <span>Supply</span></div><nav><button data-view="request">Solicitud</button>${profile?.role === 'ADMIN' ? '<button data-view="products">Productos</button>' : ''}<button id="logout">Salir</button></nav></header><main><div id="notice"></div><h1>${title}</h1><section id="content">${body}</section></main>`;
    document.querySelector('#logout').onclick = async () => { await db.auth.signOut(); location.reload(); };
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => b.dataset.view === 'products' ? productsView() : requestView()));
  }
  async function loginView() {
    root.innerHTML = `<main class="login"><h1>ORUJOS <span>Supply</span></h1><form id="login"><label>Correo<input type="email" name="email" required></label><label>Contraseña<input type="password" name="password" required></label><button>Iniciar sesión</button><p id="error"></p></form></main>`;
    document.querySelector('#login').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.currentTarget); const { error } = await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')}); if(error) document.querySelector('#error').textContent = error.message; else start(); };
  }
  async function productsView() {
    shell('Productos', '<div class="toolbar"><button id="new-product" class="primary">+ Agregar producto</button></div><div id="products">Cargando productos…</div>');
    document.querySelector('#new-product').onclick = () => productForm();
    const {data: products,error} = await db.from('products').select('*, product_scopes(area)').order('code');
    if(error) return notice(error.message,'error');
    const host = document.querySelector('#products');
    host.innerHTML = `<table><thead><tr><th>Código</th><th>Producto</th><th>Área</th><th>Unidad</th><th>Precio</th><th>Estado</th><th></th></tr></thead><tbody>${products.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${p.product_scopes.map(s=>esc(s.area)).join(', ')}</td><td>${esc(p.unit)}</td><td>${money(p.unit_price)}</td><td>${p.active?'Activo':'Inactivo'}</td><td><button class="edit-product" data-id="${p.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="7">No hay productos todavía.</td></tr>'}</tbody></table>`;
    host.querySelectorAll('.edit-product').forEach(button => button.onclick = () => productForm(products.find(p => String(p.id) === button.dataset.id)));
  }
  async function productForm(product = null) {
    const areas = ['Cocina','Servicio'];
    const ownAreas = product?.product_scopes?.map(s=>s.area) || [];
    shell(product ? 'Editar producto' : 'Agregar producto', `<form id="product-form" class="form"><div class="grid"><label>Código<input name="code" required value="${esc(product?.code)}"></label><label>Nombre<input name="name" required value="${esc(product?.name)}"></label><label>Categoría<input name="category" required value="${esc(product?.category)}"></label><label>Subcategoría<input name="subcategory" value="${esc(product?.subcategory)}"></label><label>Unidad<input name="unit" required value="${esc(product?.unit)}"></label><label>Precio unitario<input name="unit_price" type="number" min="0" step="0.01" required value="${product?.unit_price ?? ''}"></label><label>Proveedor<input name="supplier" value="${esc(product?.supplier)}"></label><label>Estado<select name="active"><option value="true" ${product?.active !== false?'selected':''}>Activo</option><option value="false" ${product?.active===false?'selected':''}>Inactivo</option></select></label></div><fieldset><legend>Visible para estas áreas</legend>${areas.map(a=>`<label class="check"><input type="checkbox" name="areas" value="${a}" ${ownAreas.includes(a)?'checked':''}> ${a}</label>`).join('')}</fieldset><label>Observaciones<textarea name="notes">${esc(product?.notes)}</textarea></label><div class="actions"><button type="button" id="cancel">Cancelar</button><button class="primary">Guardar producto</button></div></form>`);
    document.querySelector('#cancel').onclick = productsView;
    document.querySelector('#product-form').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const areasSelected = f.getAll('areas');
      if (!areasSelected.length) return notice('Selecciona Cocina, Servicio o ambas.','error');
      const payload = {code:f.get('code').trim(),name:f.get('name').trim(),category:f.get('category').trim()||null,subcategory:f.get('subcategory').trim()||null,unit:f.get('unit').trim(),unit_price:Number(f.get('unit_price')),supplier:f.get('supplier').trim()||null,notes:f.get('notes').trim()||null,active:f.get('active')==='true'};
      let id = product?.id;
      const result = id ? await db.from('products').update(payload).eq('id',id).select('id').single() : await db.from('products').insert(payload).select('id').single();
      if(result.error) return notice(result.error.message,'error'); id = result.data.id;
      const deleted = await db.from('product_scopes').delete().eq('product_id',id); if(deleted.error) return notice(deleted.error.message,'error');
      const scoped = await db.from('product_scopes').insert(areasSelected.map(area=>({product_id:id,area}))); if(scoped.error) return notice(scoped.error.message,'error');
      productsView(); notice('Producto guardado correctamente.');
    };
  }
  async function requestView() {
    const area = profile?.area || selectedArea;
    shell('Nueva solicitud', `<p>Área: <b>${esc(area || 'Selecciona un área')}</b></p>${!area ? '<div class="toolbar"><button id="cocina">Cocina</button><button id="servicio">Servicio</button></div>' : '<div id="request-products">Cargando catálogo…</div>'}`);
    if(!area) { document.querySelector('#cocina').onclick=()=>{selectedArea='Cocina';requestView()};document.querySelector('#servicio').onclick=()=>{selectedArea='Servicio';requestView()}; return; }
    const {data,error} = await db.from('products').select('*, product_scopes!inner(area)').eq('active',true).eq('product_scopes.area',area).order('name');
    if(error) return notice(error.message,'error');
    document.querySelector('#request-products').innerHTML = `<table><thead><tr><th>Producto</th><th>Unidad</th><th>Existencia</th><th>A solicitar</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${data.map(p=>`<tr data-price="${p.unit_price}"><td>${esc(p.name)}</td><td>${esc(p.unit)}</td><td><input type="number" min="0" class="stock"></td><td><input type="number" min="0" class="qty"></td><td>${money(p.unit_price)}</td><td class="subtotal">${money(0)}</td></tr>`).join('')}</tbody></table><p class="total">Total: <b id="total">${money(0)}</b></p>`;
    document.querySelectorAll('.qty').forEach(i=>i.oninput=()=>{const tr=i.closest('tr'), sub=Number(i.value||0)*Number(tr.dataset.price);tr.querySelector('.subtotal').textContent=money(sub);document.querySelector('#total').textContent=money([...document.querySelectorAll('.qty')].reduce((sum,x)=>sum+Number(x.value||0)*Number(x.closest('tr').dataset.price),0));});
  }
  async function start() { try { profile = await getProfile(); if(!profile) throw new Error('Tu usuario no tiene perfil. Pide al administrador que lo cree.'); if(!profile.active) throw new Error('Tu usuario está desactivado.'); requestView(); } catch(e) { root.innerHTML=`<main class="center"><h1>ORUJOS Supply</h1><p>${esc(e.message)}</p><button id="out">Cerrar sesión</button></main>`; document.querySelector('#out').onclick=async()=>{await db.auth.signOut();location.reload()}; } }
  db.auth.getSession().then(({data:{session}})=>session ? start() : loginView());
})();
