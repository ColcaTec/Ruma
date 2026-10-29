// Keep the receipt review screen consistent with the purchase detail shown in history.
(() => {
  const baseAddReceiptItemRow = window.addItemRow;
  const $ = id => document.getElementById(id);

  function findReceiptCatalogProduct(item) {
    const barcode = String(item?.barcode || '').trim();
    if (barcode) {
      const byBarcode = state.products.find(product => String(product.barcode || '').trim() === barcode);
      if (byBarcode) return byBarcode;
    }

    const name = normalizedProductName(item?.name || '');
    if (!name) return null;
    const exact = state.products.find(product => normalizedProductName(product.name) === name);
    if (exact) return exact;

    // OCR often drops the pack suffix. Only fill from the catalog when the prefix
    // identifies one product unambiguously; don't guess between similar variants.
    const matches = state.products.filter(product => normalizedProductName(product.name).startsWith(name));
    return matches.length === 1 ? matches[0] : null;
  }

  function receiptCatalogCandidates(name) {
    const query = normalizedProductName(name);
    return query ? state.products.filter(product => normalizedProductName(product.name).startsWith(query)) : [];
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
  }

  function attachReceiptDetails(row, data = {}) {
    if (!row || row.dataset.receiptDetails === 'true') return;
    row.dataset.receiptDetails = 'true';

    if (data.catalogProductId) row.dataset.catalogProductId = data.catalogProductId;
    if (data.catalogName) row.dataset.catalogName = data.catalogName;
    if (data.catalogBarcode) row.dataset.catalogBarcode = data.catalogBarcode;
    if (data.unitsPerPackage) row.dataset.unitsPerPackage = String(data.unitsPerPackage);
    if (data.unit) row.dataset.productUnit = data.unit;

    const looseLabel = row.querySelector('.item-loose')?.closest('label');
    if (looseLabel?.firstChild) looseLabel.firstChild.textContent = 'Unid. sueltas extra';

    const detail = document.createElement('div');
    detail.className = 'receipt-item-breakdown';
    row.append(detail);

    const refresh = () => {
      const name = row.querySelector('.item-name').value.trim();
      const barcode = row.querySelector('.item-barcode').value.trim();
      const catalogMatch = findReceiptCatalogProduct({ name, barcode });
      const rememberedProduct = row.dataset.catalogProductId &&
        normalizedProductName(name) === row.dataset.catalogName
        ? state.products.find(product => product.id === row.dataset.catalogProductId)
        : null;
      const product = catalogMatch || rememberedProduct || {
        name,
        unitsPerPackage: Number(row.dataset.unitsPerPackage) || 0,
        unit: row.dataset.productUnit || 'unidad'
      };
      const ambiguous = !catalogMatch && !rememberedProduct && receiptCatalogCandidates(name).length > 1;
      const packages = Number(row.querySelector('.item-qty').value) || 0;
      const loose = Number(row.querySelector('.item-loose').value) || 0;
      const bonus = Number(row.querySelector('.item-bonus').value) || 0;
      const cost = Number(row.querySelector('.item-cost').value) || 0;
      const salePrice = Number(row.querySelector('.item-sale-price').value) || 0;
      const size = purchaseSize(product);
      const paidUnits = packages * size + loose;
      const receivedUnits = paidUnits + bonus;
      const totalCost = purchaseValue({ qty: packages, looseUnits: loose, cost }, product);
      const unitCost = paidUnits > 0 ? totalCost / paidUnits : 0;
      const expirationDate = row.querySelector('.item-expiration').value;
      const costLabel = row.querySelector('.item-cost').closest('label');

      costLabel.firstChild.textContent = packages > 0 ? 'Costo/paq. (S/)' : 'Costo/u (S/)';
      row.querySelector('.unit-cost-preview').textContent = ambiguous
        ? 'Hay varias presentaciones; completa el nombre para calcular por unidad.'
        : paidUnits > 0 && cost > 0
          ? `Costo unitario calculado: ${money(unitCost)}`
          : 'Completa cantidades y costo para calcular.';

      detail.innerHTML = `
        <strong>Detalle calculado</strong>
        ${barcode ? `<small>Código: ${esc(barcode)}</small>` : ''}
        ${ambiguous ? '<small class="receipt-breakdown-warning">Hay varias presentaciones parecidas en tu catálogo. Completa el nombre y el contenido antes de guardar para calcular las unidades correctamente.</small>' : ''}
        <div class="receipt-breakdown-grid">
          <span>Paquetes</span><b>${formatCount(packages)}</b>
          ${size > 1 || ambiguous ? `<span>Unidades por paquete</span><b>${ambiguous ? 'Por confirmar' : formatCount(size)}</b>` : ''}
          <span>Unidades compradas</span><b>${ambiguous ? 'Por confirmar' : formatCount(paidUnits)}</b>
          <span>Unidades de regalo</span><b>${formatCount(bonus)}</b>
          <span>Total recibido</span><b>${ambiguous ? 'Por confirmar' : formatCount(receivedUnits)}</b>
          <span>${packages > 0 ? 'Costo por paquete' : 'Costo unitario'}</span><b>${money(cost)}</b>
          <span>Costo unitario calculado</span><b>${ambiguous ? 'Por confirmar presentación' : money(unitCost)}</b>
          ${salePrice > 0 ? `<span>Precio de venta / unidad</span><b>${money(salePrice)}</b>` : ''}
          <span>Costo total</span><b>${money(totalCost)}</b>
          ${expirationDate ? `<span>Vencimiento</span><b>${new Date(`${expirationDate}T12:00:00`).toLocaleDateString('es-PE')}</b>` : ''}
        </div>`;
    };

    row.querySelectorAll('.item-name,.item-barcode,.item-qty,.item-loose,.item-bonus,.item-cost,.item-sale-price,.item-expiration')
      .forEach(input => input.addEventListener('input', refresh));

    row.querySelector('.item-name').addEventListener('input', () => {
      if (row.dataset.catalogName && normalizedProductName(row.querySelector('.item-name').value) !== row.dataset.catalogName) {
        delete row.dataset.catalogProductId;
        delete row.dataset.catalogName;
        const barcode = row.querySelector('.item-barcode');
        if (barcode.value && barcode.value === row.dataset.catalogBarcode) barcode.value = '';
        delete row.dataset.catalogBarcode;
        refresh();
      }
    });

    refresh();
  }

  window.addItemRow = function(data = {}) {
    const product = data.ocrDraft ? findReceiptCatalogProduct(data) : null;
    const enriched = product ? {
      ...data,
      name: product.name,
      barcode: data.barcode || product.barcode || '',
      catalogProductId: product.id,
      catalogName: normalizedProductName(product.name),
      catalogBarcode: product.barcode || '',
      unitsPerPackage: Number(product.unitsPerPackage) || 0,
      unit: product.unit || 'unidad'
    } : data;

    baseAddReceiptItemRow(enriched);
    const row = $('receiptItems').lastElementChild;
    attachReceiptDetails(row, enriched);
    return row;
  };

  $('receiptItems').querySelectorAll('.item-row').forEach(row => attachReceiptDetails(row));
})();
