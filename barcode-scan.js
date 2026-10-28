// Camera-based barcode entry for receipt lines and the new-product form.
(() => {
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];
  let targetInput = null;
  let stream = null;
  let timer = null;
  let zxingControls = null;
  let active = false;

  const scannerDialog = document.createElement('dialog');
  scannerDialog.id = 'barcodeScannerDialog';
  scannerDialog.innerHTML = '<div class="barcode-scan-head"><h2>Escanear código</h2><button type="button" class="close-button" aria-label="Cerrar">×</button></div><video playsinline muted class="barcode-camera"></video><p class="hint" data-barcode-status>Apunta la cámara al código de barras.</p><button type="button" class="secondary-button" data-barcode-cancel>Cancelar</button>';
  document.body.append(scannerDialog);
  const video = scannerDialog.querySelector('video');
  const status = scannerDialog.querySelector('[data-barcode-status]');

  function stopScanner() {
    active = false;
    if (timer) clearTimeout(timer);
    timer = null;
    try { zxingControls?.stop(); } catch {}
    zxingControls = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }

  scannerDialog.addEventListener('close', stopScanner);
  scannerDialog.querySelector('.close-button').onclick = () => scannerDialog.close();
  scannerDialog.querySelector('[data-barcode-cancel]').onclick = () => scannerDialog.close();
  scannerDialog.addEventListener('click', event => { if (event.target === scannerDialog) scannerDialog.close(); });

  function catalogMatch(code) {
    if (typeof state === 'undefined') return null;
    return state.products.find(product => String(product.barcode || '').trim() === code.trim()) || null;
  }

  function applyBarcode(code) {
    if (!targetInput || !code) return;
    targetInput.value = code;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    const product = catalogMatch(code);
    const row = targetInput.closest('.item-row');
    if (product && row) {
      row.querySelector('.item-name').value = product.name;
      row.querySelector('.item-cost').value = product.cost ?? '';
    }
    if (product && targetInput.id === 'newProductBarcode') {
      document.getElementById('newProductName').value = product.name;
      document.getElementById('newProductCost').value = product.cost ?? '';
      document.getElementById('newProductUnit').value = product.unit || 'unidad';
    }
    if (typeof toast === 'function') toast(product ? `Código reconocido: ${product.name}` : `Código reconocido: ${code}`);
    scannerDialog.close();
  }

  function decorateBarcodeInput(input) {
    if (!input || input.dataset.scanReady === 'true') return;
    input.dataset.scanReady = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'barcode-entry';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'barcode-scan-button';
    button.textContent = 'Escanear';
    button.setAttribute('aria-label', 'Escanear código de barras');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      startScanner(input);
    });
    wrapper.append(button);
  }

  function decorateAll() {
    document.querySelectorAll('.item-barcode').forEach(decorateBarcodeInput);
    decorateBarcodeInput(document.getElementById('newProductBarcode'));
  }

  const receiptItems = document.getElementById('receiptItems');
  new MutationObserver(decorateAll).observe(receiptItems, { childList: true });
  decorateAll();

  function loadZXing() {
    if (window.ZXingBrowser?.BrowserMultiFormatReader) return Promise.resolve(window.ZXingBrowser);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
      script.onload = () => window.ZXingBrowser?.BrowserMultiFormatReader ? resolve(window.ZXingBrowser) : reject(new Error('No se pudo cargar el lector compatible.'));
      script.onerror = () => reject(new Error('No se pudo cargar el lector de códigos. Revisa tu conexión.'));
      document.head.append(script);
    });
  }

  async function startZXing() {
    const ZXing = await loadZXing();
    if (!active) return;
    status.textContent = 'Enfoca el código dentro de la cámara…';
    const reader = new ZXing.BrowserMultiFormatReader();
    await reader.decodeFromVideoDevice(undefined, video, (result, _error, controls) => {
      if (controls) zxingControls = controls;
      if (result && active) applyBarcode(result.getText());
    });
  }

  async function startScanner(input) {
    targetInput = input;
    status.textContent = 'Solicitando permiso para usar la cámara…';
    scannerDialog.showModal();
    active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Este navegador no permite abrir la cámara. Abre Ruma con Chrome o Safari y habilita el permiso de cámara.';
      return;
    }
    try {
      if ('BarcodeDetector' in window && window.isSecureContext) {
        const supported = typeof BarcodeDetector.getSupportedFormats === 'function' ? await BarcodeDetector.getSupportedFormats() : [];
        const scanFormats = formats.filter(format => supported.includes(format));
        if (scanFormats.length) {
          const detector = new BarcodeDetector({ formats: scanFormats });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          video.srcObject = stream;
          await video.play();
          status.textContent = 'Enfoca el código dentro de la cámara…';
          const scan = async () => {
            if (!active) return;
            try {
              const codes = await detector.detect(video);
              if (codes.length) { applyBarcode(codes[0].rawValue); return; }
            } catch {}
            timer = setTimeout(scan, 180);
          };
          scan();
          return;
        }
      }
      await startZXing();
    } catch (error) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        status.textContent = 'No hay permiso para usar la cámara. Habilita el permiso de cámara para Ruma en los ajustes del navegador.';
      } else {
        status.textContent = error.message || 'No se pudo iniciar el escáner. Revisa el permiso de cámara e inténtalo otra vez.';
      }
      stopScanner();
    }
  }
})();

