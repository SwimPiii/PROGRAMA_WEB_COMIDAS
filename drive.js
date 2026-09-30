(function () {
  const cfg = window.COMIDAS_CONFIG || {};
  const state = { initialized: false, signedIn: false, folderId: cfg.driveFolderId || null, fileId: null, lastError: null };
  let tokenClient = null;
  const BACKUP_SLOTS = 10;

  function waitFor(predicate, timeoutMs = 12000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const poll = () => {
        if (predicate()) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error("Los servicios de Google no se han cargado. Comprueba tu conexión e inténtalo de nuevo."));
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  async function init() {
    await waitFor(() => window.gapi && window.gapi.load && window.google && window.google.accounts && window.google.accounts.oauth2);
    await new Promise((resolve, reject) => window.gapi.load("client", async () => {
      try {
        await window.gapi.client.init({ discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"] });
        state.initialized = true;
        resolve();
      } catch (error) { reject(error); }
    }));
    if (!cfg.googleClientId) throw new Error("Falta configurar el Client ID de Google en config.js.");
  }

  function quote(value) { return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

  async function resolveFolder() {
    if (state.folderId) {
      try {
        const folder = await window.gapi.client.drive.files.get({ fileId: state.folderId, fields: "id,mimeType" });
        if (folder.result.mimeType === "application/vnd.google-apps.folder") return state.folderId;
      } catch (error) { state.lastError = error; }
    }
    const query = `name='${quote(cfg.driveFolderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const result = await window.gapi.client.drive.files.list({ q: query, pageSize: 10, fields: "files(id,name)" });
    if (result.result.files && result.result.files.length) {
      state.folderId = result.result.files[0].id;
      return state.folderId;
    }
    const created = await window.gapi.client.drive.files.create({ resource: { name: cfg.driveFolderName, mimeType: "application/vnd.google-apps.folder" }, fields: "id" });
    state.folderId = created.result.id;
    return state.folderId;
  }

  async function findFile(folderId, name) {
    const q = `name='${quote(name)}' and '${quote(folderId)}' in parents and trashed=false`;
    const response = await window.gapi.client.drive.files.list({ q, pageSize: 10, fields: "files(id,name)" });
    return response.result.files && response.result.files.length ? response.result.files[0] : null;
  }

  async function upload(fileId, content, name) {
    const boundary = "comidas_boundary_2026";
    const delimiter = `\r\n--${boundary}\r\n`;
    const body = delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name, mimeType: "application/json" }) + delimiter + "Content-Type: application/json\r\n\r\n" + content + `\r\n--${boundary}--`;
    return window.gapi.client.request({ path: `/upload/drive/v3/files/${fileId}`, method: "PATCH", params: { uploadType: "multipart" }, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  }

  async function createJson(folderId, name, content) {
    const file = await window.gapi.client.drive.files.create({ resource: { name, mimeType: "application/json", parents: [folderId] }, fields: "id" });
    await upload(file.result.id, content, name);
    return file.result.id;
  }

  async function ensureFile() {
    const folderId = await resolveFolder();
    const file = await findFile(folderId, cfg.driveFileName);
    if (file) state.fileId = file.id;
    else state.fileId = await createJson(folderId, cfg.driveFileName, JSON.stringify({ version: 1, recipes: [], plans: {}, shopping: { extras: [], checked: {} }, lastUpdated: new Date().toISOString() }));
  }

  function baseName() { return String(cfg.driveFileName).replace(/\.json$/i, ""); }
  function stamp(date) { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "_").replace("Z", ""); }
  function manifestName() { return `${baseName()}__backups_manifest.json`; }

  async function saveBackup(payload, folderId) {
    const manifestFile = await findFile(folderId, manifestName());
    let manifest = { nextSlot: 1, slots: {} };
    if (manifestFile) {
      try {
        const result = await window.gapi.client.drive.files.get({ fileId: manifestFile.id, alt: "media" });
        if (result.result && typeof result.result === "object") manifest = result.result;
      } catch (error) { state.lastError = error; }
    }
    const slot = Number(manifest.nextSlot) >= 1 && Number(manifest.nextSlot) <= BACKUP_SLOTS ? Number(manifest.nextSlot) : 1;
    const old = manifest.slots && manifest.slots[String(slot)];
    if (old && old.fileId) {
      try { await window.gapi.client.drive.files.delete({ fileId: old.fileId }); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    const savedAt = new Date().toISOString();
    const fileName = `${baseName()}__backup_${String(slot).padStart(2, "0")}__${stamp(new Date(savedAt))}.json`;
    const id = await createJson(folderId, fileName, JSON.stringify({ backupMetadata: { slot, savedAt, sourceFileName: cfg.driveFileName }, state: payload }));
    manifest = { nextSlot: slot === BACKUP_SLOTS ? 1 : slot + 1, latestSlot: slot, latestSavedAt: savedAt, slots: { ...(manifest.slots || {}), [String(slot)]: { fileId: id, fileName, savedAt } } };
    if (manifestFile) await upload(manifestFile.id, JSON.stringify(manifest), manifestName());
    else await createJson(folderId, manifestName(), JSON.stringify(manifest));
  }

  async function signIn() {
    await init();
    tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: cfg.googleClientId, scope: cfg.googleScopes, hint: cfg.googleAccountHint, callback: "", error_callback: error => { state.lastError = error; } });
    return new Promise((resolve, reject) => {
      tokenClient.callback = async response => {
        try {
          if (!response || !response.access_token) throw new Error("Google no devolvió un token de acceso.");
          window.gapi.client.setToken({ access_token: response.access_token });
          state.signedIn = true;
          await ensureFile();
          const data = await load();
          resolve(data);
        } catch (error) { state.lastError = error; state.signedIn = false; reject(error); }
      };
      try { tokenClient.requestAccessToken({ prompt: "consent", hint: cfg.googleAccountHint }); }
      catch (error) { reject(error); }
    });
  }

  async function load() {
    if (!state.signedIn) throw new Error("Conecta con Google Drive para cargar los datos.");
    if (!state.fileId) await ensureFile();
    const response = await window.gapi.client.drive.files.get({ fileId: state.fileId, alt: "media" });
    const data = response.result;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("El archivo de datos de Drive no tiene un formato válido.");
    return data;
  }

  async function save(payload) {
    if (!state.signedIn) throw new Error("Conecta con Google Drive antes de guardar.");
    if (!state.fileId) await ensureFile();
    const folderId = await resolveFolder();
    await upload(state.fileId, JSON.stringify(payload), cfg.driveFileName);
    await saveBackup(payload, folderId);
  }

  async function signOut() {
    try {
      const token = window.gapi.client.getToken();
      if (token && token.access_token) await new Promise(resolve => window.google.accounts.oauth2.revoke(token.access_token, resolve));
    } finally {
      if (window.gapi && window.gapi.client) window.gapi.client.setToken("");
      state.signedIn = false;
      state.fileId = null;
    }
  }

  window.comidasDrive = { signIn, signOut, load, save, isSignedIn: () => state.signedIn, getDebugInfo: () => ({ folderId: state.folderId, fileId: state.fileId, lastError: state.lastError }) };
})();
