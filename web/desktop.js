import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const desktop = isTauri();

export async function saveBlob(blob, filename) {
  if (desktop) {
    try {
      return await invoke("save_file", await blob.arrayBuffer(), {
        headers: { "x-filename": encodeURIComponent(filename) },
      });
    } catch (error) {
      throw new Error(String(error));
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return filename;
}

export async function connectDesktop({ open, flush, report }) {
  if (!desktop) return;
  let reading = Promise.resolve();
  const receiveNext = async () => {
    try {
      const document = await invoke("take_document");
      if (document) await open(document.name, document.text);
    } catch (error) {
      report(String(error));
    }
  };
  const receive = () => (reading = reading.then(receiveNext));
  await listen("open-document", receive);
  await listen("save-before-quit", async () => {
    try {
      await invoke("finish_quit", { confirmed: await flush() });
    } catch (error) {
      report(String(error));
      await invoke("finish_quit", { confirmed: false });
    }
  });
  document.getElementById("documentation-open").onclick = event => {
    event.preventDefault();
    invoke("show_help").catch(error => report(String(error)));
  };
  await receive();
  await invoke("viewer_ready");
}
