// Ruma OCR bridge: sends the complete receipt image to the protected Gemini
// Edge Function. The publishable Supabase key is designed for browser clients;
// the Gemini API key remains a server-side Supabase secret.
(() => {
  const SUPABASE_URL = 'https://cifeodsuansioztrvvkw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_YP8RoLbMQnRYh2WOB7CPjw_jPS5Ky73';
  const SESSION_KEY = 'ruma_auth_v1';
  const $ = (id) => document.getElementById(id);
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
    return new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('No se pudo preparar la foto.'));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.88));
  }

  $('readReceipt').onclick = async () => {
    const file = $('receiptInput').files?.[0];
    if (!file) return;
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
    status.textContent = 'Analizando la foto completa y separando los productos…';
    try {
      const canvas = await preprocessReceipt(file);
      const imageBase64 = await encodeImage(canvas);
      const response = await fetch(`${SUPABASE_URL}/functions/v1/leer-boleta`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mime: 'image/jpeg' }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        localStorage.removeItem(SESSION_KEY);
        login.hidden = false;
        throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
      }
      if (response.status === 403) throw new Error('Tu cuenta aún no está habilitada para usar Ruma. Pide al administrador que la active.');
      if (!response.ok) {
        if (result.error === 'sin_clave_gemini') throw new Error('Falta configurar GEMINI_API_KEY en los secretos de Supabase.');
        if (result.error === 'gemini') throw new Error(`Gemini respondió con error ${result.status || ''}. Revisa el modelo y la clave configurados en Supabase.`);
        throw new Error(result.detail || result.error || 'No se pudo analizar la foto.');
      }
      const data = result.data || {};
      const supplier = data.proveedor?.nombre;
      if (supplier) { $('receiptSupplier').value = supplier; $('receiptSupplier').dataset.ocr = 'true'; }
      if (data.documento?.fecha) $('receiptDate').value = data.documento.fecha;
      $('ocrText').textContent = JSON.stringify(data, null, 2);
      $('ocrDetails').hidden = false;
      const items = Array.isArray(data.items) ? data.items.filter(item => item && (item.producto || item.texto_original)) : [];
      const manual = [...$('receiptItems').querySelectorAll('.item-row')].filter(row => row.querySelector('.item-name').value.trim());
      $('receiptItems').querySelectorAll('[data-ocr-draft="true"]').forEach(row => row.remove());
      if (!manual.length) $('receiptItems').querySelectorAll('.item-row').forEach(row => { if (!row.querySelector('.item-name').value.trim()) row.remove(); });
      items.forEach(item => addItemRow({ name: item.producto || item.texto_original, qty: item.cantidad || 1, cost: item.precio_unitario ?? '', ocrDraft: true }));
      if (!items.length) {
        if (!$('receiptItems').querySelector('.item-row')) addItemRow();
        status.textContent = `No se detectaron productos con suficiente información. ${Array.isArray(data.alertas) ? data.alertas.join(' ') : 'Revisa la foto o agrégalos manualmente.'}`;
      } else {
        const low = items.filter(item => item.confianza === 'baja').length;
        status.textContent = `Gemini propuso ${items.length} producto${items.length === 1 ? '' : 's'}${supplier ? ` de ${supplier}` : ''}${low ? `; ${low} requiere${low === 1 ? '' : 'n'} revisión especial` : ''}. Confirma todo antes de guardar.`;
        if (Array.isArray(data.alertas) && data.alertas.length) status.textContent += ` ${data.alertas.join(' ')}`;
      }
    } catch (error) {
      status.textContent = error.message || 'No se pudo analizar la foto. Puedes completar los datos manualmente.';
    } finally { button.disabled = false; }
  };
})();

