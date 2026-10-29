// Keep the receipt review screen consistent with the purchase detail shown in history.
(() => {
  const baseAddReceiptItemRow = window.addItemRow;
  const $ = id => document.getElementById(id);

  function countPackSize(product) {
    const info = window.RumaUnits?.packageInfo(product);
    if (info?.type === 'count' && Number(info.size) > 1) return Number(info.size);
    const inferred = itemPackSize(product);
    return inferred > 1 ? inferred : 0;
  }

  function parseReceiptDate(value) {
    const toValidISO = (year, month, day) => {
      const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const date = new Date(`${isoDate}T12:00:00`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === isoDate ? isoDate : '';
    };
    const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return toValidISO(iso[1], iso[2], iso[3]);
    const local = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (!local) return '';
    const year = local[3].length === 2 ? `20${local[3]}` : local[3];
    return toValidISO(year, local[2], local[1]);
  }

  function validBarcode(value) {
    if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
    const digits = [...value].map(Number);
    const check = digits.pop();
    const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
    return (10 - sum % 10) % 10 === check;
  }

  const baseParseReceiptProduct = window.parseReceiptProduct;
  window.parseReceiptProduct = function(line) {
    const raw = String(line || '').trim();
    const saleMatch = raw.match(/\b(?:precio\s*(?:de\s*)?venta|p\.?\s*venta|venta\s*(?:\/\s*u|unitaria))\s*[:#=\-]?\s*(?:S\s*\/\s*)?(\d+(?:[.,]\d{1,2})?)/i);
    const parserLine = saleMatch ? raw.replace(saleMatch[0], ' ') : line;
    const item = baseParseReceiptProduct(parserLine);
    if (!item) return item;

    const rawCode = raw.match(/^(\d{8,14})(?!\d)(?=\s)/)?.[1] || '';
    const barcode = validBarcode(rawCode) ? rawCode : '';
    const expiryMatch = raw.match(/\b(?:venc(?:imiento|e)?|fecha\s+de\s+vencimiento|fv|expiraci[oó]n)\s*[:#=\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/i);
    const catalogProduct = findReceiptCatalogProduct({ name: item.name, barcode });
    const product = catalogProduct || { name: item.name };
    const unitsPerPackage = countPackSize(product);

    return {
      ...item,
      name: catalogProduct?.name || item.name,
      barcode: barcode || catalogProduct?.barcode || '',
      unitsPerPackage,
      salePrice: saleMatch ? Number(saleMatch[1].replace(',', '.')) : '',
      expirationDate: expiryMatch ? parseReceiptDate(expiryMatch[1]) : ''
    };
  };

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

  function packMetadata(product) {
    return window.RumaUnits?.packageInfo(product) || { size: itemPackSize(product), type: itemPackSize(product) > 1 ? 'count' : 'single' };
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

    const packageLabel = document.createElement('label');
    const initialProduct = state.products.find(product => product.id === row.dataset.catalogProductId) ||
      findReceiptCatalogProduct({
        name: row.querySelector('.item-name').value,
        barcode: row.querySelector('.item-barcode').value
      }) || { name: row.querySelector('.item-name').value, unitsPerPackage: Number(data.unitsPerPackage) || 0 };
    const initialPackInfo = packMetadata(initialProduct);
    const initialPackSize = initialPackInfo.type === 'count'
      ? Number(data.unitsPerPackage) || Number(initialPackInfo.size) || 0
      : 0;
    packageLabel.innerHTML = `Unidades por paquete<input class="item-pack-size" type="number" min="1" step="1" value="${initialPackSize > 1 ? initialPackSize : ''}" placeholder="Ej. 24">`;
    if (initialPackInfo.type === 'weight') packageLabel.hidden = true;
    row.querySelector('.item-qty').closest('label').after(packageLabel);
    if (initialPackSize > 1) row.dataset.unitsPerPackage = String(initialPackSize);

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
      const packInput = row.querySelector('.item-pack-size');
      const selectedPackSize = Number(packInput.value) || 0;
      const product = catalogMatch || rememberedProduct || {
        name,
        unitsPerPackage: selectedPackSize || Number(row.dataset.unitsPerPackage) || 0,
        unit: row.dataset.productUnit || 'unidad'
      };
      const ambiguous = !catalogMatch && !rememberedProduct && receiptCatalogCandidates(name).length > 1;
      const unresolvedPack = ambiguous && selectedPackSize <= 1;
      const packages = Number(row.querySelector('.item-qty').value) || 0;
      const loose = Number(row.querySelector('.item-loose').value) || 0;
      const bonus = Number(row.querySelector('.item-bonus').value) || 0;
      const cost = Number(row.querySelector('.item-cost').value) || 0;
      const salePrice = Number(row.querySelector('.item-sale-price').value) || 0;
      const metadata = packMetadata(product);
      const effectiveProduct = metadata.type === 'count' && selectedPackSize > 1
        ? { ...product, unitsPerPackage: selectedPackSize }
        : product;
      const size = metadata.type === 'count' && selectedPackSize > 1
        ? selectedPackSize
        : purchaseSize(effectiveProduct);
      const paidUnits = packages * size + loose;
      const receivedUnits = paidUnits + bonus;
      const totalCost = purchaseValue({ qty: packages, looseUnits: loose, cost }, effectiveProduct);
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
          ${size > 1 || ambiguous ? `<span>Unidades por paquete</span><b>${unresolvedPack ? 'Por confirmar' : formatCount(size)}</b>` : ''}
          <span>Unidades compradas</span><b>${unresolvedPack ? 'Por confirmar' : formatCount(paidUnits)}</b>
          <span>Unidades de regalo</span><b>${formatCount(bonus)}</b>
          <span>Total recibido</span><b>${unresolvedPack ? 'Por confirmar' : formatCount(receivedUnits)}</b>
          <span>${packages > 0 ? 'Costo por paquete' : 'Costo unitario'}</span><b>${money(cost)}</b>
          <span>Costo unitario calculado</span><b>${unresolvedPack ? 'Por confirmar presentación' : money(unitCost)}</b>
          ${salePrice > 0 ? `<span>Precio de venta / unidad</span><b>${money(salePrice)}</b>` : ''}
          <span>Costo total</span><b>${money(totalCost)}</b>
          ${expirationDate ? `<span>Vencimiento</span><b>${new Date(`${expirationDate}T12:00:00`).toLocaleDateString('es-PE')}</b>` : ''}
        </div>`;
    };

    const packSizeInput = row.querySelector('.item-pack-size');
    packSizeInput.addEventListener('input', () => { packSizeInput.dataset.manual = 'true'; refresh(); });
    row.querySelectorAll('.item-name,.item-barcode,.item-qty,.item-loose,.item-bonus,.item-cost,.item-sale-price,.item-expiration')
      .forEach(input => input.addEventListener('input', refresh));

    row.querySelector('.item-name').addEventListener('input', () => {
      if (row.dataset.catalogName && normalizedProductName(row.querySelector('.item-name').value) !== row.dataset.catalogName) {
        delete row.dataset.catalogProductId;
        delete row.dataset.catalogName;
        const barcode = row.querySelector('.item-barcode');
        if (barcode.value && barcode.value === row.dataset.catalogBarcode) barcode.value = '';
        delete row.dataset.catalogBarcode;
        if (packSizeInput.dataset.manual !== 'true') {
          const product = findReceiptCatalogProduct({ name: row.querySelector('.item-name').value });
          const inferredSize = product ? countPackSize(product) : countPackSize({ name: row.querySelector('.item-name').value });
          const inferredInfo = packMetadata(product || { name: row.querySelector('.item-name').value });
          packageLabel.hidden = inferredInfo.type === 'weight';
          packSizeInput.value = inferredSize > 1 ? String(inferredSize) : '';
          if (inferredSize > 1) row.dataset.unitsPerPackage = String(inferredSize);
          else delete row.dataset.unitsPerPackage;
        }
        refresh();
      }
    });

    row.querySelector('.item-name').addEventListener('input', () => {
      if (packSizeInput.dataset.manual === 'true') return;
      const barcodeInput = row.querySelector('.item-barcode');
      const matched = findReceiptCatalogProduct({
        name: row.querySelector('.item-name').value,
        barcode: barcodeInput.value
      });
      const source = matched || { name: row.querySelector('.item-name').value };
      const info = packMetadata(source);
      const inferredSize = countPackSize(source);
      packageLabel.hidden = info.type === 'weight';
      packSizeInput.value = inferredSize > 1 ? String(inferredSize) : '';
      if (inferredSize > 1) row.dataset.unitsPerPackage = String(inferredSize);
      else delete row.dataset.unitsPerPackage;
      if (matched && !barcodeInput.value && matched.barcode) {
        barcodeInput.value = matched.barcode;
        row.dataset.catalogProductId = matched.id;
        row.dataset.catalogName = normalizedProductName(matched.name);
        row.dataset.catalogBarcode = matched.barcode;
      }
      refresh();
    });

    row.querySelector('.item-barcode').addEventListener('input', () => {
      if (packSizeInput.dataset.manual === 'true') return;
      const barcodeInput = row.querySelector('.item-barcode');
      const matched = findReceiptCatalogProduct({
        name: row.querySelector('.item-name').value,
        barcode: barcodeInput.value
      });
      if (!matched) { refresh(); return; }
      const info = packMetadata(matched);
      packageLabel.hidden = info.type === 'weight';
      packSizeInput.value = info.type === 'count' && Number(info.size) > 1 ? String(info.size) : '';
      row.dataset.catalogProductId = matched.id;
      row.dataset.catalogName = normalizedProductName(matched.name);
      row.dataset.catalogBarcode = matched.barcode || '';
      if (row.querySelector('.item-name').value.trim() && normalizedProductName(row.querySelector('.item-name').value) !== normalizedProductName(matched.name)) {
        row.dataset.catalogName = '';
      }
      refresh();
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
      unitsPerPackage: countPackSize(product),
      unit: product.unit || 'unidad'
    } : data;

    baseAddReceiptItemRow(enriched);
    const row = $('receiptItems').lastElementChild;
    attachReceiptDetails(row, enriched);
    return row;
  };

  $('receiptItems').querySelectorAll('.item-row').forEach(row => attachReceiptDetails(row));

  $('saveReceipt').onclick = () => {
    const rows = [...$('receiptItems').querySelectorAll('.item-row')];
    const items = rows.map(row => ({
      name: row.querySelector('.item-name').value.trim(),
      barcode: row.querySelector('.item-barcode').value.trim(),
      qty: Number(row.querySelector('.item-qty').value) || 0,
      unitsPerPackage: Number(row.querySelector('.item-pack-size').value) || 0,
      looseUnits: Number(row.querySelector('.item-loose').value) || 0,
      bonusUnits: Number(row.querySelector('.item-bonus').value) || 0,
      cost: Number(row.querySelector('.item-cost').value) || 0,
      salePrice: Number(row.querySelector('.item-sale-price').value) || 0,
      expirationDate: row.querySelector('.item-expiration').value || ''
    })).filter(item => item.name && (item.qty > 0 || item.looseUnits > 0 || item.bonusUnits > 0));

    if (!items.length) {
      toast('Agrega un producto y registra paquetes o unidades sueltas.');
      return;
    }

    const matchedProducts = new Map();
    items.forEach(item => {
      let product = (item.barcode && state.products.find(existing => existing.barcode === item.barcode)) ||
        state.products.find(existing => receiptNameKey(existing) === receiptNameKey(item)) ||
        findReceiptCatalogProduct(item);
      if (!product) {
        product = addProduct({
          name: item.name,
          barcode: item.barcode,
          stock: 0,
          cost: item.cost,
          unit: 'unidad',
          unitsPerPackage: item.unitsPerPackage || itemPackSize(item)
        });
      } else {
        item.name = product.name;
        if (!item.barcode) item.barcode = product.barcode || '';
        if (item.barcode && !product.barcode) product.barcode = item.barcode;
        const knownPackSize = countPackSize(product);
        if (item.unitsPerPackage <= 1) item.unitsPerPackage = knownPackSize;
        if (item.unitsPerPackage > 1 && packMetadata(product).type === 'count') product.unitsPerPackage = item.unitsPerPackage;
      }
      matchedProducts.set(item, product);
    });

    const purchase = {
      id: crypto.randomUUID(),
      supplier: $('receiptSupplier').value.trim(),
      date: $('receiptDate').value || today(),
      items,
      total: items.reduce((sum, item) => sum + purchaseValue(item, matchedProducts.get(item) || item), 0),
      source: 'boleta'
    };
    items.forEach(item => receiveStock(matchedProducts.get(item), item));
    state.purchases.push(purchase);
    saveState();
    $('receiptItems').innerHTML = '';
    window.addItemRow();
    $('receiptSupplier').value = '';
    $('receiptInput').value = '';
    $('receiptPreviewWrap').hidden = true;
    toast('Compra guardada, stock actualizado y vencimiento registrado.');
    go('inicio');
  };
})();
