
const roleSelect = document.getElementById("role");
const executeButton = document.getElementById("execute");
const roleIcon = document.getElementById("roleIcon");
const status = document.getElementById("status");
const reportLink = document.getElementById("reportLink");

function render(role) {
  const publisher = role === "publisher";
  const subscriber = role === "subscriber";

  roleIcon.style.display = role ? "block" : "none";

  if (role) {
    roleIcon.src = publisher
      ? "icons/publisher.svg"
      : "icons/subscriber.svg";
  }

  executeButton.disabled = !role;
  executeButton.textContent = publisher
    ? "Exportar marcadores"
    : subscriber
      ? "Importar y reemplazar"
      : "Seleccionar perfil";

  reportLink.style.display = "none";
  executeButton.style.background = publisher
    ? "#16834A"
    : "#2563EB";
}

chrome.storage.local.get(["role", "lastImport"], ({ role, lastImport }) => {
  roleSelect.value = role || "";
  render(role || "");
  if (role === "subscriber" && lastImport?.omitted > 0) {
    reportLink.style.display = "block";
  }
});

roleSelect.addEventListener("change", async () => {
  const role = roleSelect.value;

  if (!role) return;

  const response = await chrome.runtime.sendMessage({
    action: "setRole",
    role
  });

  status.textContent = response.ok
    ? "Perfil guardado"
    : response.error;

  render(role);
});

executeButton.addEventListener("click", async () => {
  const role = roleSelect.value;

  executeButton.disabled = true;
  status.textContent = "Procesando...";

  try {
    const response = await chrome.runtime.sendMessage({
      action: role === "publisher" ? "export" : "import"
    });

    status.textContent = response.ok
      ? response.message
      : "Error: " + response.error;
    if (response.ok && role === "subscriber" && response.omitted > 0) {
      reportLink.style.display = "block";
    }
  } catch (error) {
    status.textContent = "Error: " + error.message;
  } finally {
    executeButton.disabled = !role;
  }
});
