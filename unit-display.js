// Show package stock and its equivalent number of sellable pieces.
(() => {
  const $ = id => document.getElementById(id);
  const formatQty = value => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });
  const inferPackSize = name => {
    const match = String(name || '').match(/\bx\s*(\d{1,3})\b/i);
    const size = match ? Number(match[1]) : 1;
    return Number.isFinite(size) && size > 1 ? size : 1;
  };
  const packageSize = product => {
    const explicit = Number(product.unitsPerPackage || 0);
    return explicit > 1 ? explicit : inferPackSize(product.name);
  };
  const isPack = product => packageSize(product) > 1;
  const packageUnit = product => /^(unidad|und|u)$/i.test(String(product.unit || 'unidad')) ? 'paquete' : String(product.unit || 'paquete');
  const unitName = product => /^(unidad|und|u)$/i.test(String(product.unit || 'unidad')) ? 'unidad' : String(product.unit || 'unidad');

  // Add an explicit pack-size field to the existing product form.
  const costInput = $('newProductCost');
  if (costInput && !$('newProductPackSize')) {
    const label = document.createElement('label');
    label.innerHTML = 'Unidades por paquete (si aplica)<input id="newProductPackSize" type="number" min="1" step="1" placeholder="Ej. 24"><small class="hint">Si el nombre incluye “x24”, Ruma lo propone automáticamente.</small>';
    costInput.closest('label').before(label);
    const nameInput = $('newProductName');
    const packInput = $('newProductPackSize');
    nameInput.addEventListener('input', () => {
      if (packInput.dataset.manual === 'true') return;
      const size = inferPackSize(nameInput.value);
      packInput.value = size > 1 ? size : '';
    });
    packInput.addEventListener('input', () => { packInput.dataset.manual = 'true'; });
    $('newProduct').addEventListener('click', () => { packInput.value = ''; delete packInput.dataset.manual; });
  }

  // Existing records keep working: read x24/x12/x15 from the product name.
  if (typeof window.addProduct === 'function' && !window.addProduct.__rumaPackWrapped) {
    const addProduct = window.addProduct;
    const wrapped = function(data) {
      const explicit = Number(data.unitsPerPackage || $('newProductPackSize')?.value || 0);
      const product = addProduct(data);
      product.unitsPerPackage = explicit > 1 ? explicit : inferPackSize(data.name);
      if (typeof saveState === 'function') saveState();
      return product;
    };
    wrapped.__rumaPackWrapped = true;
    window.addProduct = wrapped;
  }

  function renderProductsWithUnits() {
    if (!$('productList')) return;
    const query = ($('productSearch')?.value || '').toLocaleLowerCase('es-PE');
    const products = state.products.filter(product => product.name.toLocaleLowerCase('es-PE').includes(query) || (product.barcode || '').includes(query));
    $('productList').innerHTML = products.length ? products.map(product => {
      const stock = Number(product.stock || 0);
      const size = packageSize(product);
      const pack = size > 1;
      const eachCount = stock * size;
      const cost = Number(product.cost || 0);
      const detail = pack
        ? `${esc(product.barcode || 'Sin código')} · ${money(cost)} / ${esc(packageUnit(product))} · ${money(cost / size)} / ${esc(unitName(product))}`
        : `${esc(product.barcode || 'Sin código')} · ${money(cost)} / ${esc(product.unit || 'unidad')}`;
      const stockInfo = pack
        ? `<span class="row-total"><strong>${formatQty(eachCount)} unidades</strong><small>${formatQty(stock)} ${esc(packageUnit(product))}${Math.abs(stock) === 1 || packageUnit(product).endsWith('s') ? '' : 's'}</small></span>`
        : `<span class="row-total">${formatQty(stock)} ${esc(product.unit || 'unidad')}</span>`;
      return `<div class="product-row"><span class="row-icon">▦</span><span class="row-main"><strong>${esc(product.name)}</strong><small>${detail}</small></span>${stockInfo}</div>`;
    }).join('') : '<p class="empty-state">No hay productos todavía. Crea uno desde “+ Nuevo”.</p>';
  }

  if (typeof window.renderProducts === 'function') window.renderProducts = renderProductsWithUnits;
  if (typeof window.render === 'function' && !window.render.__rumaPackWrapped) {
    const render = window.render;
    const wrapped = function() {
      render();
      const units = state.products.reduce((total, product) => total + Number(product.stock || 0) * packageSize(product), 0);
      if ($('stockCount')) $('stockCount').textContent = formatQty(units);
    };
    wrapped.__rumaPackWrapped = true;
    window.render = wrapped;
  }
  renderProductsWithUnits();
  if (typeof window.render === 'function') {
    const units = state.products.reduce((total, product) => total + Number(product.stock || 0) * packageSize(product), 0);
    if ($('stockCount')) $('stockCount').textContent = formatQty(units);
  }
  window.RumaUnits = { packageSize, inferPackSize };
})();

