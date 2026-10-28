(() => {
  const URL = 'https://eetngbdhgszyknslsjxy.supabase.co';
  const KEY = 'sb_publishable_KKlDNprxh6szSDMwcz8_jA_hrofgybv';
  const SESSION_KEY = 'ruma_account_session_v1';
  let session = null;
  let businessId = null;
  let revision = 0;
  let timer = null;
  let app = null;
  let syncing = false;
  let pending = false;
  let pendingData = null;
  let changeVersion = 0;

  const $ = id => document.getElementById(id);
  const stateLabel = (text, state = '') => {
    const el = $('syncStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.state = state;
  };
  const parseResponse = async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || 'No se pudo conectar con Ruma.');
    return data;
  };
  const authRequest = async (path, body) => parseResponse(await fetch(`${URL}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const readSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  };
  const writeSession = value => {
    session = value;
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  };
  async function validSession() {
    session = readSession();
    if (!session?.access_token) return null;
    if (Number(session.expires_at || 0) < Math.floor(Date.now() / 1000) + 60) {
      if (!session.refresh_token) { localStorage.removeItem(SESSION_KEY); session = null; return null; }
      try {
        const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        session = { ...refreshed, expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600) };
        writeSession(session);
      } catch { localStorage.removeItem(SESSION_KEY); session = null; return null; }
    }
    return session;
  }
  async function api(path, options = {}) {
    const current = await validSession();
    if (!current) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
    const response = await fetch(`${URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${current.access_token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    return parseResponse(response);
  }
  async function loadCloud() {
    const user = await parseResponse(await fetch(`${URL}/auth/v1/user`, {
      headers: { apikey: KEY, Authorization: `Bearer ${(await validSession()).access_token}` },
    }));
    const memberships = await api(`business_members?select=business_id&user_id=eq.${encodeURIComponent(user.id)}`);
    if (!memberships.length) throw new Error('No se encontró el espacio de esta cuenta. Cierra sesión e inténtalo otra vez.');
    businessId = memberships[0].business_id;
    $('accountEmail').textContent = user.email || 'Cuenta Ruma';
    const rows = await api(`inventory_snapshots?select=data,revision,updated_at&business_id=eq.${encodeURIComponent(businessId)}&limit=1`);
    return { user, row: rows[0] || null };
  }
  async function saveSnapshot(data, expectedRevision) {
    const result = await api('rpc/ruma_save_inventory_snapshot', {
      method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_data: data, p_expected_revision: expectedRevision }),
    });
    return Number(result);
  }
  function hasData(data) { return Boolean(data?.products?.length || data?.purchases?.length || data?.sales?.length); }
  function showApp() {
    $('authGate').hidden = true;
    $('appMain').hidden = false;
    $('sectionNav').hidden = false;
    $('accountControls').hidden = false;
  }
  function showGate() {
    $('authGate').hidden = false;
    $('appMain').hidden = true;
    $('sectionNav').hidden = true;
    $('accountControls').hidden = true;
  }
  async function applyCloudData(data, rowRevision) {
    revision = Number(rowRevision || 0);
    app.replaceData(data || { products: [], purchases: [] });
    if (businessId) localStorage.setItem(`ruma_inventory_${businessId}_v1`, JSON.stringify(app.getLocalData()));
  }
  async function afterSignIn() {
    stateLabel('Cargando tu inventario…');
    const { user, row } = await loadCloud();
    const claimed = localStorage.getItem('ruma_legacy_inventory_owner_v1');
    let local = { products: [], purchases: [] };
    const ownCache = localStorage.getItem(`ruma_inventory_${businessId}_v1`);
    if (ownCache) {
      try { local = JSON.parse(ownCache); } catch { local = { products: [], purchases: [] }; }
    } else if (!claimed) {
      local = app.getLocalData();
      localStorage.setItem('ruma_legacy_inventory_owner_v1', user.id);
    }
    if (row) {
      if (hasData(local) && !hasData(row.data)) {
        await applyCloudData(local, row.revision);
        showApp();
        stateLabel('Inventario de este dispositivo pendiente de subir', 'error');
        const count = local.products?.length || 0;
        if (confirm(`Encontré ${count} producto${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'} en este dispositivo. La nube está vacía. ¿Quieres importarlo a tu cuenta Ruma?`)) await importLocal(false);
        return;
      }
      const hasSeparateCopy = row.data?.bonusUnitModel === 'bonus-units-v1' && hasData(local) && hasData(row.data) && JSON.stringify(local) !== JSON.stringify(row.data);
      if (hasSeparateCopy) {
        localStorage.setItem(`ruma_legacy_backup_${businessId}_v1`, JSON.stringify(local));
      }
      await applyCloudData(row.data, row.revision);
      if (row.data?.bonusUnitModel !== 'bonus-units-v1') revision = await saveSnapshot(app.getLocalData(), revision);
      showApp();
      stateLabel(hasSeparateCopy ? 'La nube ya tiene datos; una copia diferente de este dispositivo quedó guardada por separado' : 'Sincronizado', hasSeparateCopy ? 'error' : 'saved');
      return;
    }
    revision = 0;
    if (hasData(local)) {
      await applyCloudData(local, 0);
      showApp();
      stateLabel('Inventario de este dispositivo pendiente de subir', 'error');
      const count = local.products?.length || 0;
      if (confirm(`Encontré ${count} producto${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'} en este dispositivo. ¿Quieres importarlo a tu cuenta Ruma para verlo también en tus otros dispositivos?`)) {
        await importLocal(false);
      }
      return;
    }
    const emptyInventory = { products: [], purchases: [], sales: [], bonusUnitModel: 'bonus-units-v1' };
    await applyCloudData(emptyInventory, 0);
    revision = await saveSnapshot(emptyInventory, 0);
    showApp();
    stateLabel('Sincronizado', 'saved');
  }
  function formStatus(text) { $('authStatus').textContent = text; }
  function friendlyAuthError(error, mode) {
    const message = String(error?.message || error || '');
    if (/email rate limit exceeded|over_email_send_rate_limit/i.test(message)) {
      if (mode === 'recovery') return 'Supabase alcanzó su límite gratuito de correos. Espera antes de volver a solicitar el enlace; sin SMTP, el envío también puede estar limitado a correos autorizados del proyecto.';
      return 'Se alcanzó el límite gratuito de correos de confirmación de Supabase (2 por hora). Revisa tu bandeja y spam; si no llegó ningún correo, espera una hora antes de volver a crear la cuenta. Para permitir más registros habrá que configurar un servicio SMTP propio.';
    }
    if (/email address not authorized|email_address_not_authorized/i.test(message)) return 'Supabase no permite enviar correos a esta dirección con el servicio gratuito. Para recibir recuperación en Gmail hace falta configurar un remitente SMTP.';
    if (/already registered|user already exists/i.test(message)) return 'Ese correo ya tiene una cuenta. Prueba “Iniciar sesión”; si aún no la confirmaste, revisa el correo de verificación.';
    if (/invalid login credentials/i.test(message)) return 'El correo o la contraseña no coinciden. Si todavía no creaste la cuenta, pulsa “Crear cuenta”.';
    if (/redirect.*not allowed|not whitelisted/i.test(message)) return 'Supabase no tiene autorizada la dirección de Ruma para volver después de confirmar el correo. Hay que agregar https://colcatec.github.io/Ruma/ en Auth → URL Configuration.';
    return message || (mode === 'signup' ? 'No se pudo crear la cuenta.' : 'No se pudo iniciar sesión. Revisa el correo y la contraseña.');
  }
  function installSession(data) {
    const next = { ...data, expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600) };
    writeSession(next);
  }
  const recoveryTokens = new URLSearchParams(location.hash.replace(/^#/, ''));
  const recoveryAccessToken = recoveryTokens.get('access_token');
  const recoveryType = recoveryTokens.get('type');
  if (recoveryType === 'recovery' && recoveryAccessToken) {
    $('authForm').hidden = true;
    $('resetPasswordForm').hidden = false;
    $('resetPasswordTitle').textContent = 'Nueva contraseña';
  }
  $('forgotPasswordButton').addEventListener('click', async () => {
    const emailInput = $('authForm').elements.email;
    const email = emailInput.value.trim();
    if (!email) {
      emailInput.focus();
      formStatus('Escribe tu correo y luego pulsa “Olvidé mi contraseña”.');
      return;
    }
    const button = $('forgotPasswordButton');
    button.disabled = true;
    formStatus('Solicitando el enlace de recuperación…');
    try {
      const redirect = `${location.origin}${location.pathname}`;
      const endpoint = `recover?redirect_to=${encodeURIComponent(redirect)}`;
      await authRequest(endpoint, { email });
      formStatus('Si la cuenta existe, Supabase enviará un enlace de recuperación. Revisa también spam.');
    } catch (error) {
      formStatus(friendlyAuthError(error, 'recovery'));
    } finally { button.disabled = false; }
  });
  $('resetPasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('newPassword') || '');
    const confirmation = String(form.get('confirmPassword') || '');
    if (password !== confirmation) {
      $('resetPasswordStatus').textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    $('resetPasswordStatus').textContent = 'Actualizando contraseña…';
    try {
      await parseResponse(await fetch(`${URL}/auth/v1/user`, {
        method: 'PUT',
        headers: { apikey: KEY, Authorization: `Bearer ${recoveryAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }));
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      event.currentTarget.reset();
      event.currentTarget.hidden = true;
      $('authForm').hidden = false;
      formStatus('Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.');
      $('authForm').elements.email.focus();
    } catch (error) {
      $('resetPasswordStatus').textContent = /expired|invalid|token/i.test(error.message)
        ? 'El enlace venció o ya se usó. Solicita otro enlace desde “Olvidé mi contraseña”.'
        : error.message || 'No se pudo actualizar la contraseña.';
    } finally { button.disabled = false; }
  });
  $('authForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submitter = event.submitter;
    const mode = submitter?.value || 'login';
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    $('authForm').querySelectorAll('button').forEach(button => button.disabled = true);
    formStatus(mode === 'signup' ? 'Creando tu cuenta…' : 'Verificando tus datos…');
    try {
      const result = mode === 'signup'
        ? await authRequest('signup', { email, password })
        : await authRequest('token?grant_type=password', { email, password });
      if (!result.access_token) {
        formStatus('Cuenta creada. Revisa tu correo y confirma la dirección para poder iniciar sesión.');
        return;
      }
      installSession(result);
      formStatus('Sesión iniciada. Cargando tu inventario…');
      await afterSignIn();
      event.currentTarget.reset();
      formStatus('');
    } catch (error) {
      formStatus(friendlyAuthError(error, mode));
    } finally { $('authForm').querySelectorAll('button').forEach(button => button.disabled = false); }
  });
  async function importLocal(showConfirmation = false) {
    if (!businessId || syncing) return;
    const data = app.getLocalData();
    if (!hasData(data)) { stateLabel('Este dispositivo no tiene datos para importar'); return; }
    if (showConfirmation && !confirm('Subirás el inventario guardado en este dispositivo. Solo se puede importar si la cuenta todavía no tiene productos ni compras.')) return;
    const rows = await api(`inventory_snapshots?select=data,revision&business_id=eq.${encodeURIComponent(businessId)}&limit=1`);
    const row = rows[0] || null;
    if (row && hasData(row.data)) {
      stateLabel('La cuenta ya tiene inventario; no se reemplazó', 'error');
      alert('Esta cuenta ya tiene productos o compras en la nube. No se reemplazó nada.');
      return;
    }
    revision = Number(row?.revision || 0);
    syncing = true;
    try {
      revision = await saveSnapshot(data, revision);
      stateLabel('Inventario importado y sincronizado', 'saved');
    } catch (error) { stateLabel(error.message || 'No se pudo importar el inventario', 'error'); }
    finally { syncing = false; }
  }
  $('importLocalButton').addEventListener('click', () => importLocal(true));
  $('signOutButton').addEventListener('click', async () => {
    const current = await validSession();
    try { if (current) await fetch(`${URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${current.access_token}` } }); } catch {}
    localStorage.removeItem(SESSION_KEY);
    session = null; businessId = null; revision = 0;
    showGate(); formStatus('Cerraste sesión. Tus datos siguen guardados en la nube.');
  });
  function changed(data) {
    if (!session || !businessId) return;
    localStorage.setItem(`ruma_inventory_${businessId}_v1`, JSON.stringify(data));
    pendingData = data;
    changeVersion++;
    pending = true;
    stateLabel('Guardando…');
    clearTimeout(timer);
    timer = setTimeout(() => pushLatest(data), 700);
  }
  async function pushLatest(data) {
    if (data) pendingData = data;
    if (!pending || syncing || !businessId) return;
    syncing = true;
    const versionAtStart = changeVersion;
    try {
      revision = await saveSnapshot(pendingData, revision);
      if (versionAtStart === changeVersion) {
        pending = false;
        stateLabel('Sincronizado', 'saved');
      }
    } catch (error) {
      if (String(error.message).includes('cambió en otro dispositivo')) {
        pending = false;
        localStorage.setItem('ruma_conflict_backup_v1', JSON.stringify(app.getLocalData()));
        await pullLatest(true);
        stateLabel('Llegaron cambios de otro dispositivo. Tu copia anterior quedó guardada en este navegador.', 'error');
      } else {
        pending = true;
        stateLabel(`Sin conexión con la nube; se reintentará. ${error.message}`, 'error');
      }
    } finally {
      syncing = false;
      if (pending) timer = setTimeout(() => pushLatest(pendingData), 8000);
    }
  }
  async function pullLatest(keepBackup = false) {
    if (!businessId) return;
    const rows = await api(`inventory_snapshots?select=data,revision&business_id=eq.${encodeURIComponent(businessId)}&limit=1`);
    const row = rows[0];
    if (!row || Number(row.revision) <= revision) return;
    if (keepBackup) localStorage.setItem('ruma_conflict_backup_v1', JSON.stringify(app.getLocalData()));
    const needsMigration = row.data?.bonusUnitModel !== 'bonus-units-v1';
    await applyCloudData(row.data, row.revision);
    if (needsMigration) revision = await saveSnapshot(app.getLocalData(), revision);
  }
  async function refreshOnFocus() {
    if (document.visibilityState !== 'visible' || !businessId || pending || syncing) return;
    try { await pullLatest(); } catch { /* The next focus or polling cycle will retry. */ }
  }
  window.addEventListener('focus', refreshOnFocus);
  window.addEventListener('online', () => { if (pending) pushLatest(pendingData); });
  setInterval(refreshOnFocus, 20000);

  async function init(callbacks) {
    app = callbacks;
    const current = await validSession();
    if (!current) { showGate(); return; }
    try { await afterSignIn(); }
    catch (error) { showGate(); formStatus(error.message || 'No se pudo cargar tu cuenta. Intenta iniciar sesión otra vez.'); }
  }
  async function searchSharedProducts(query) {
    const rows = await api('rpc/ruma_search_shared_products', { method: 'POST', body: JSON.stringify({ p_query: query }) });
    return Array.isArray(rows) ? rows : [];
  }
  async function publishSharedProduct(product) {
    const rows = await api('rpc/ruma_publish_shared_product', { method: 'POST', body: JSON.stringify({
      p_name: product.name, p_barcode: product.barcode || null, p_unit: product.unit || 'unidad',
      p_units_per_package: Number(product.unitsPerPackage) || 1,
    }) });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  window.RumaCloud = { init, changed, searchSharedProducts, publishSharedProduct, signOut: () => $('signOutButton').click() };
})();
