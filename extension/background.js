const HOST = "com.bookmark_sync.native_host";
// Política semántica: no sincronizar contenedores especiales como la Papelera.
// No se utilizan IDs, posiciones, títulos ni nombres de navegador.
const EXCLUDED_FOLDER_TYPES = new Set(["trash", "managed"]);

function nativeRequest(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST, payload, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || "Error del host nativo"));
      else resolve(response);
    });
  });
}

function serializeNode(node) {
  if (node.url !== undefined) return { title: node.title || "", url: node.url };
  return { title: node.title || "", children: (node.children || []).map(serializeNode) };
}

function discoverRoots(tree) {
  const top = tree?.[0]?.children;
  if (!Array.isArray(top)) throw new Error("Árbol de marcadores incompatible");
  const roots = new Map();
  for (const root of top) {
    const type = root.folderType;
    if (typeof type !== "string" || !type.trim() || EXCLUDED_FOLDER_TYPES.has(type)) continue;
    if (root.unmodifiable) continue;
    if (roots.has(type)) throw new Error(`folderType duplicado: ${type}`);
    roots.set(type, root);
  }
  if (!roots.size) throw new Error("No se encontraron raíces identificables por folderType");
  return roots;
}

function countUrls(nodes) {
  return nodes.reduce((sum, node) => sum + (Object.hasOwn(node, "url") ? 1 : countUrls(node.children)), 0);
}

function validateNodes(nodes, depth = 0) {
  if (!Array.isArray(nodes) || depth > 100) throw new Error("Estructura JSON inválida");
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof node.title !== "string") {
      throw new Error("Marcador inválido");
    }
    if (Object.hasOwn(node, "url")) {
      if (typeof node.url !== "string" || !node.url.trim() || Object.hasOwn(node, "children")) {
        throw new Error("Estructura de URL inválida");
      }
    } else validateNodes(node.children, depth + 1);
  }
}

async function createNodes(parentId, nodes, rootKey, rejected, path = "") {
  let created = 0;
  for (const node of nodes) {
    const location = path ? `${path} / ${node.title}` : node.title;
    if (Object.hasOwn(node, "url")) {
      try {
        await chrome.bookmarks.create({ parentId, title: node.title, url: node.url });
        created++;
      } catch (error) {
        rejected.push({ root: rootKey, title: node.title, url: node.url, reason: error.message, location });
      }
    } else {
      // Los errores de creación de carpetas sí detienen la preparación.
      const folder = await chrome.bookmarks.create({ parentId, title: node.title });
      created += await createNodes(folder.id, node.children, rootKey, rejected, location);
    }
  }
  return created;
}

async function removeNode(node) {
  if (node.url !== undefined) await chrome.bookmarks.remove(node.id);
  else await chrome.bookmarks.removeTree(node.id);
}

async function exportBookmarks() {
  const roots = discoverRoots(await chrome.bookmarks.getTree());
  const payload = {
    format: "bookmark-sync", version: 2, exportedAt: new Date().toISOString(),
    roots: [...roots].map(([folderType, root]) => ({
      folderType, children: (root.children || []).map(serializeNode)
    }))
  };
  const result = await nativeRequest({ action: "write", data: payload });
  return { message: `Exportación completada (${payload.roots.length} raíces)`, path: result.path };
}

function collectOmittedUrls(nodes, rootKey, path = "") {
  const result = [];
  for (const node of nodes) {
    const location = path ? `${path} / ${node.title}` : node.title;
    if (Object.hasOwn(node, "url")) {
      result.push({ root: rootKey, title: node.title, url: node.url, location,
        reason: `Raíz ${rootKey} no disponible en el navegador destino` });
    } else {
      result.push(...collectOmittedUrls(node.children, rootKey, location));
    }
  }
  return result;
}

async function importBookmarks() {
  const { data } = await nativeRequest({ action: "read" });
  if (data?.format !== "bookmark-sync" || data.version !== 2 || !Array.isArray(data.roots)) {
    throw new Error("Archivo canónico incompatible. Exporta nuevamente desde Publisher.");
  }
  if (!data.roots.length) throw new Error("El archivo canónico no contiene raíces");
  const seen = new Set();
  for (const item of data.roots) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.folderType !== "string" || !item.folderType.trim() ||
        EXCLUDED_FOLDER_TYPES.has(item.folderType) || seen.has(item.folderType)) {
      throw new Error("Raíz inválida, excluida o duplicada");
    }
    seen.add(item.folderType);
    validateNodes(item.children);
  }

  const roots = discoverRoots(await chrome.bookmarks.getTree());
  const plan = [];
  const skippedRoots = [];
  let omittedByRoot = 0;
  for (const item of data.roots) {
    const key = item.folderType;
    const nodes = item.children;
    const root = roots.get(key);
    if (!root) {
      const count = countUrls(nodes);
      omittedByRoot += count;
      if (count) skippedRoots.push({ root: key, count, bookmarks: collectOmittedUrls(nodes, key) });
    } else plan.push({ key, root, nodes });
  }
  if (!plan.length) throw new Error("No hay raíces compatibles; importación cancelada sin cambios");

  // Respaldo de la estructura anterior antes de cualquier modificación.
  const backup = { createdAt: new Date().toISOString(), roots: {} };
  for (const item of plan) backup.roots[item.key] = (item.root.children || []).map(serializeNode);
  await chrome.storage.local.set({ subscriberBackup: backup });

  const prepared = [];
  const rejected = [];
  let imported = 0;
  try {
    // Se crean las carpetas de preparación en cada raíz y se verifica su contenido.
    for (const item of plan) {
      const staging = await chrome.bookmarks.create({
        parentId: item.root.id,
        title: "__bookmark_sync_staging__"
      });
      const entry = { ...item, stagingId: staging.id };
      prepared.push(entry);
      entry.created = await createNodes(staging.id, item.nodes, item.key, rejected);
      const staged = (await chrome.bookmarks.getSubTree(staging.id))[0];
      if (countUrls(staged.children || []) !== entry.created) {
        throw new Error(`Verificación fallida en ${item.key}`);
      }
    }
  } catch (error) {
    for (const item of prepared) {
      try { await chrome.bookmarks.removeTree(item.stagingId); } catch (_) {}
    }
    throw error;
  }

  // Guardar el reporte antes de comenzar el reemplazo destructivo.
  try {
    await nativeRequest({ action: "write_import_report", report: {
      date: new Date().toISOString(), imported: prepared.reduce((n, p) => n + p.created, 0),
      rejected, skippedRoots, omittedByRoot
    } });
  } catch (error) {
    for (const item of prepared) {
      try { await chrome.bookmarks.removeTree(item.stagingId); } catch (_) {}
    }
    throw error;
  }

  // IMPORTANTE: el snapshot original no incluye las carpetas staging.
  // Esta fase no es atómica; usar un perfil de prueba en la primera ejecución.
  for (const item of prepared) {
    for (const child of item.root.children || []) await removeNode(child);
    const staged = (await chrome.bookmarks.getSubTree(item.stagingId))[0];
    for (const child of staged.children || []) {
      await chrome.bookmarks.move(child.id, { parentId: item.root.id });
    }
    await chrome.bookmarks.removeTree(item.stagingId);
    imported += item.created;
  }

  const omitted = omittedByRoot + rejected.length;
  await chrome.storage.local.set({ lastImport: { imported, omitted, rejected: rejected.length, at: new Date().toISOString() } });
  return {
    imported, omitted, rejected: rejected.length, omittedByRoot,
    message: `Importación completada: ${imported} importados, ${omitted} omitidos` +
      (omitted ? ". Ver reporte de importación." : ".")
  };
}

async function updateRole(role) {
  const roles = { publisher: { badge: "PUB", color: "#16834A" }, subscriber: { badge: "SUB", color: "#2563EB" } };
  const config = roles[role];
  if (!config) throw new Error(`Rol no válido: ${role}`);
  await chrome.storage.local.set({ role });
  await chrome.action.setIcon({ path: {
    16: `icons/${role}-16.png`, 32: `icons/${role}-32.png`,
    48: `icons/${role}-48.png`, 128: `icons/${role}-128.png`
  } });
  await chrome.action.setBadgeText({ text: config.badge });
  await chrome.action.setBadgeBackgroundColor({ color: config.color });
  await chrome.action.setTitle({ title: `Bookmark Sync — ${role.toUpperCase()}` });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { role } = await chrome.storage.local.get("role");
  if (role) await updateRole(role);
});
chrome.runtime.onStartup.addListener(async () => {
  const { role } = await chrome.storage.local.get("role");
  if (role) await updateRole(role);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === "setRole") {
        if (!["publisher", "subscriber"].includes(message.role)) throw new Error("Rol inválido");
        await updateRole(message.role);
        sendResponse({ ok: true });
        return;
      }
      if (message.action === "readImportReport") {
        sendResponse(await nativeRequest({ action: "read_import_report" }));
        return;
      }
      const { role } = await chrome.storage.local.get("role");
      if (message.action === "export" && role === "publisher") {
        sendResponse({ ok: true, ...await exportBookmarks() });
      } else if (message.action === "import" && role === "subscriber") {
        sendResponse({ ok: true, ...await importBookmarks() });
      } else throw new Error("Operación no permitida para este rol");
    } catch (error) { sendResponse({ ok: false, error: error.message }); }
  })();
  return true;
});
