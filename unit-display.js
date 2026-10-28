// Show package stock and its equivalent number of sellable pieces.
(() => {
  const $ = id => document.getElementById(id);
  const formatQty = value => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });
  const inferPackSize = name => {
    const value = String(name || '');
    const match = value.match(/\bx\s*(\d{1,3})\b/i) || value.match(/\b(\d{1,3})\s*(?:piezas?|unidades?|und\.?|u\.?\s*n\.?\s*d\.?)\b/i);
    const size = match ? Number(match[1]) : 1;
    return Number.isFinite(size) && size > 1 ? size : 1;
  };
  const packageInfo = product => {
    const explicit = Number(product.unitsPerPackage || 0);
    if (explicit > 1) return { size: explicit, type: 'count', itemUnit: 'unidad', packUnit: 'paquete' };
    const count = inferPackSize(product.name);
    if (count > 1) return { size: count, type: 'count', itemUnit: 'unidad', packUnit: 'paquete' };
    const weight = String(product.name || '').match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
    if (weight) {
      const value = Number(weight[1].replace(',', '.'));
      const kg = weight[2].toLowerCase() === 'g' ? value / 1000 : value;
      if (kg > 0) return { size: kg, type: 'weight', itemUnit: 'kg', packUnit: kg >= 25 ? 'saco' : 'bolsa' };
    }
    return { size: 1, type: 'single', itemUnit: String(product.unit || 'unidad'), packUnit: String(product.unit || 'unidad') };
  };
  const packageSize = product => packageInfo(product).size;

  // Add an explicit pack-size field to the existing product form.
  const costInput = $('newProductCost');
  if (costInput && !$('newProductPackSize')) {
    const label = document.createElement('label');
    label.innerHTML = 'Unidades por paquete (si aplica)<input id="newProductPackSize" type="number" min="1" step="1" placeholder="Ej. 24"><small class="hint">Ruma lo propone si el nombre incluye “x24” o “24 piezas”.</small>';
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
      const info = packageInfo(product);
      const size = info.size;
      const pack = info.type !== 'single';
      const eachCount = stock * size;
      const cost = Number(product.cost || 0);
      const unitCost = Number(product.averageUnitCost || cost / size);
      const detail = pack
        ? `${esc(product.barcode || 'Sin código')} · ${money(cost)} / ${esc(info.packUnit)} · ${money(unitCost)} / ${esc(info.itemUnit)}`
        : `${esc(product.barcode || 'Sin código')} · ${money(cost)} / ${esc(product.unit || 'unidad')}`;
      const wholePackages = Math.floor(stock + 1e-8);
      const looseUnits = info.type === 'count' ? Math.round((stock - wholePackages) * size) : 0;
      const packageDescription = `${wholePackages} ${info.packUnit}${wholePackages === 1 ? '' : 's'}${looseUnits > 0 ? ` + ${looseUnits} suelta${looseUnits === 1 ? '' : 's'}` : ''}`;
      const stockInfo = pack
        ? `<span class="row-total"><strong>${formatQty(eachCount)} ${esc(info.type === 'weight' ? info.itemUnit : 'unidades')}</strong><small>${esc(info.type === 'count' ? packageDescription : `${formatQty(stock)} ${info.packUnit}${Math.abs(stock) === 1 || info.packUnit.endsWith('s') ? '' : 's'}`)}</small></span>`
        : `<span class="row-total">${formatQty(stock)} ${esc(product.unit || 'unidad')}</span>`;
      return `<div class="product-row"><span class="row-icon">▦</span><span class="row-main"><strong>${esc(product.name)}</strong><small>${detail}</small></span>${stockInfo}</div>`;
    }).join('') : '<p class="empty-state">No hay productos todavía. Crea uno desde “+ Nuevo”.</p>';
  }

  if (typeof window.renderProducts === 'function') window.renderProducts = renderProductsWithUnits;
  if (typeof window.render === 'function' && !window.render.__rumaPackWrapped) {
    const render = window.render;
    const wrapped = function() {
      render();
      const units = state.products.reduce((total, product) => total + (packageInfo(product).type === 'weight' ? 0 : Number(product.stock || 0) * packageSize(product)), 0);
      if ($('stockCount')) $('stockCount').textContent = formatQty(units);
    };
    wrapped.__rumaPackWrapped = true;
    window.render = wrapped;
  }
  renderProductsWithUnits();
  if (typeof window.render === 'function') {
    const units = state.products.reduce((total, product) => total + (packageInfo(product).type === 'weight' ? 0 : Number(product.stock || 0) * packageSize(product)), 0);
    if ($('stockCount')) $('stockCount').textContent = formatQty(units);
  }
  window.RumaUnits = { packageSize, inferPackSize, packageInfo };
})();
