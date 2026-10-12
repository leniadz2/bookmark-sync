const content = document.getElementById("content");
const status = document.getElementById("status");
const download = document.getElementById("download");
let reportText = "";

(async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: "readImportReport" });
    if (!response?.ok) throw new Error(response?.error || "No se pudo leer el reporte");
    reportText = response.text;
    content.textContent = reportText;
    status.textContent = "Reporte cargado";
    download.disabled = false;
  } catch (error) {
    status.textContent = "Error: " + error.message;
  }
})();

download.addEventListener("click", () => {
  const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "import-errors.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
