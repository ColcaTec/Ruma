// Ruma OCR bridge: sends the complete receipt image to the protected Gemini
// Edge Function. The publishable Supabase key is designed for browser clients;
// the Gemini API key remains a server-side Supabase secret.
(() => {
  const SUPABASE_URL = 'https://cifeodsuansioztrvvkw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_YP8RoLbMQnRYh2WOB7CPjw_jPS5Ky73';
  const SESSION_KEY = 'ruma_auth_v1';
  const $ = (id) => document.getElementById(id);
  let selectedReceiptFiles = [];
  let previewUrls = [];
  const getSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  };
  const setSession = (value) => localStorage.setItem(SESSION_KEY, JSON.stringify(value));

  async function authRequest(path, body) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || result.error || 'No se pudo iniciar sesión.');
    return result;
  }

  async function validSession() {
    let session = getSession();
    if (!session?.access_token) return null;
    if (Number(session.expires_at || 0) < Math.floor(Date.now() / 1000) + 60) {
      if (!session.refresh_token) { localStorage.removeItem(SESSION_KEY); return null; }
      try {
        const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        session = { ...refreshed, expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600) };
        setSession(session);
      } catch { localStorage.removeItem(SESSION_KEY); return null; }
    }
    return session;
  }

  function ensureLoginForm() {
    let form = $('rumaOcrLogin');
    if (form) return form;
    form = document.createElement('form');
    form.id = 'rumaOcrLogin';
    form.className = 'form-card';
    form.hidden = true;
    form.innerHTML = '<h2>Inicia sesión para leer la boleta</h2><p class="hint">Usa tu cuenta de Ruma. Si tu usuario aún no está activado, el administrador debe habilitarlo en Supabase.</p><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button class="secondary-button" type="submit">Iniciar sesión</button><p class="hint" data-login-status role="status"></p>';
    $('receiptPreviewWrap').after(form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('[data-login-status]');
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status.textContent = 'Verificando cuenta…';
      try {
        const data = new FormData(form);
        const result = await authRequest('token?grant_type=password', { email: data.get('email'), password: data.get('password') });
        setSession({ ...result, expires_at: Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600) });
        status.textContent = 'Sesión iniciada. Pulsa “Leer boleta” otra vez.';
        form.reset();
      } catch (error) {
        status.textContent = error.message || 'No se pudo iniciar sesión.';
      } finally { button.disabled = false; }
    });
    return form;
  }

  function encodeImage(canvas) {
    const source = canvas;
    if (source instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result);
          resolve({ image: dataUrl.split(',')[1], mime: dataUrl.match(/^data:([^;]+)/)?.[1] || source.type || 'image/jpeg' });
        };
        reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
        reader.readAsDataURL(source);
      });
    }
    return new Promise((resolve, reject) => source.toBlob((blob) => {
      if (!blob) return reject(new Error('No se pudo preparar la foto.'));
      const reader = new FileReader();
      reader.onload = () => resolve({ image: String(reader.result).split(',')[1], mime: 'image/jpeg' });
      reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.88));
  }

  function renderReceiptFiles() {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls = [];
    const preview = $('receiptImagesPreview');
    preview.replaceChildren();
    selectedReceiptFiles.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const card = document.createElement('div');
      card.className = 'receipt-image-card';
      const image = document.createElement('img');
      image.src = url;
      image.alt = `Foto ${index + 1} de la boleta`;
      const caption = document.createElement('small');
      caption.textContent = `Foto ${index + 1} · ${file.name || 'captura del celular'}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'receipt-image-remove';
      remove.setAttribute('aria-label', `Quitar foto ${index + 1}`);
      remove.textContent = '×';
      remove.onclick = () => {
        selectedReceiptFiles.splice(index, 1);
        renderReceiptFiles();
      };
      card.append(image, caption, remove);
      preview.append(card);
    });
    $('receiptPreviewWrap').hidden = selectedReceiptFiles.length === 0;
    $('ocrDetails').hidden = true;
    if (selectedReceiptFiles.length) {
      $('ocrStatus').textContent = `${selectedReceiptFiles.length} foto${selectedReceiptFiles.length === 1 ? '' : 's'} lista${selectedReceiptFiles.length === 1 ? '' : 's'}. Puedes tomar otra, elegir más de la galería o quitar alguna antes de leer.`;
    }
  }

  function addReceiptFiles(fileList) {
    const files = [...(fileList || [])].filter(file => file.type.startsWith('image/'));
    const room = Math.max(0, 8 - selectedReceiptFiles.length);
    const additions = files.slice(0, room).filter(file => !selectedReceiptFiles.some(old => old.name === file.name && old.size === file.size && old.lastModified === file.lastModified));
    selectedReceiptFiles.push(...additions);
    renderReceiptFiles();
    if (files.length > room) $('ocrStatus').textContent = 'Puedes adjuntar hasta 8 fotos por boleta. Quita una foto si necesitas reemplazarla.';
    if (!files.length) $('ocrStatus').textContent = 'No se agregó ninguna imagen. Intenta elegir fotos desde la galería o tomar una nueva.';
  }

  $('receiptInput').onchange = event => { addReceiptFiles(event.target.files); event.target.value = ''; };
  $('receiptCameraInput').onchange = event => { addReceiptFiles(event.target.files); event.target.value = ''; };
  $('saveReceipt').addEventListener('click', () => setTimeout(() => {
    if ($('receiptPreviewWrap').hidden) {
      selectedReceiptFiles = [];
      renderReceiptFiles();
    }
  }, 0));

  async function analyzeReceiptPhoto(file, session) {
    const prepared = await preprocessReceipt(file);
    const encoded = await encodeImage(prepared);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/leer-boleta`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: encoded.image, mime: encoded.mime }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
    }
    if (response.status === 403) throw new Error('Tu cuenta aún no está habilitada para usar Ruma. Pide al administrador que la active.');
    if (!response.ok) {
      if (result.error === 'sin_clave_gemini') throw new Error('Falta configurar GEMINI_API_KEY en los secretos de Supabase.');
      if (result.error === 'gemini' && result.status === 503) throw new Error('Gemini está temporalmente saturado (503). La función ya reintentó el análisis; espera un momento y vuelve a leer la boleta.');
      if (result.error === 'gemini' && result.status === 429) throw new Error('Gemini alcanzó el límite de solicitudes. Espera un momento y vuelve a intentarlo.');
      if (result.error === 'gemini') throw new Error(`Gemini respondió con error ${result.status || ''}. Revisa la clave y el modelo en Supabase.`);
      throw new Error(result.detail || result.error || 'No se pudo analizar esta foto.');
    }
    return result.data || {};
  }

  $('readReceipt').onclick = async () => {
    if (!selectedReceiptFiles.length) return;
    const login = ensureLoginForm();
    const session = await validSession();
    if (!session) {
      login.hidden = false;
      login.querySelector('input[name="email"]').focus();
      $('ocrStatus').textContent = 'Inicia sesión para analizar la boleta.';
      return;
    }
    login.hidden = true;
    const button = $('readReceipt');
    const status = $('ocrStatus');
    button.disabled = true;
    status.textContent = `Preparando ${selectedReceiptFiles.length} foto${selectedReceiptFiles.length === 1 ? '' : 's'}…`;
    try {
      const documents = [];
      for (let i = 0; i < selectedReceiptFiles.length; i++) {
        status.textContent = `Analizando foto ${i + 1} de ${selectedReceiptFiles.length}…`;
        try {
          documents.push(await analyzeReceiptPhoto(selectedReceiptFiles[i], session));
        } catch (error) {
          if (error.message.includes('sesión venció')) login.hidden = false;
          throw new Error(`No se pudo analizar la foto ${i + 1}: ${error.message}`);
        }
      }
      const supplier = documents.map(document => document.proveedor?.nombre).find(Boolean);
      if (supplier) { $('receiptSupplier').value = supplier; $('receiptSupplier').dataset.ocr = 'true'; }
      const date = documents.map(document => document.documento?.fecha).find(Boolean);
      if (date) $('receiptDate').value = date;
      const items = documents.flatMap(document => Array.isArray(document.items) ? document.items : []).filter(item => item && (item.producto || item.texto_original));
      const alerts = documents.flatMap(document => Array.isArray(document.alertas) ? document.alertas : []);
      $('ocrText').textContent = JSON.stringify({ documentos: documents.length, proveedor: supplier || null, items, alertas: alerts }, null, 2);
      $('ocrDetails').hidden = false;
      const manual = [...$('receiptItems').querySelectorAll('.item-row')].filter(row => row.querySelector('.item-name').value.trim());
      $('receiptItems').querySelectorAll('[data-ocr-draft="true"]').forEach(row => row.remove());
      if (!manual.length) $('receiptItems').querySelectorAll('.item-row').forEach(row => { if (!row.querySelector('.item-name').value.trim()) row.remove(); });
      items.forEach(item => addItemRow({ name: item.producto || item.texto_original, qty: item.cantidad ?? '', cost: item.precio_unitario ?? '', ocrDraft: true }));
      if (!items.length) {
        if (!$('receiptItems').querySelector('.item-row')) addItemRow();
        status.textContent = `Se analizaron ${documents.length} foto${documents.length === 1 ? '' : 's'}, pero no se detectaron productos con suficiente información. ${alerts.join(' ') || 'Revisa las imágenes o agrégalos manualmente.'}`;
      } else {
        const low = items.filter(item => item.confianza === 'baja').length;
        status.textContent = `Gemini analizó ${documents.length} foto${documents.length === 1 ? '' : 's'} y propuso ${items.length} producto${items.length === 1 ? '' : 's'}${supplier ? ` de ${supplier}` : ''}${low ? `; ${low} requiere${low === 1 ? '' : 'n'} revisión especial` : ''}. Confirma todo antes de guardar.`;
        if (alerts.length) status.textContent += ` ${alerts.join(' ')}`;
      }
    } catch (error) {
      status.textContent = error.message || 'No se pudo analizar la foto. Puedes completar los datos manualmente.';
    } finally { button.disabled = false; }
  };
})();

