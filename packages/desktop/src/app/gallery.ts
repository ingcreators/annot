import {
  listImages,
  listProjects,
  deleteImage,
  loadScreenshot,
  isTauri,
  type ImageInfo,
  type Project,
} from "@ingcreators/annot-core/utils/tauri-bridge";

export class Gallery {
  #container: HTMLElement;
  #projectSelect: HTMLSelectElement | null = null;
  #searchInput: HTMLInputElement | null = null;
  #grid: HTMLElement;
  #projects: Project[] = [];
  #images: ImageInfo[] = [];
  #currentProjectId: number | null = null;

  /** Currently selected project ID (null = all projects) */
  get currentProjectId(): number | null { return this.#currentProjectId; }

  onOpenImage?: (dataUrl: string, width: number, height: number, imageId?: number) => void;

  constructor(container: HTMLElement) {
    this.#container = container;
    this.#grid = container.querySelector(".gallery-grid")!;
    this.#setupControls();
    this.refresh();
  }

  #setupControls(): void {
    const header = this.#container.querySelector(".gallery-header")!;
    const actions = header.querySelector(".gallery-actions")!;

    // Project selector
    const projectWrap = document.createElement("div");
    projectWrap.className = "gallery-project-select";

    const label = document.createElement("span");
    label.className = "gallery-label";
    label.textContent = "Project:";
    projectWrap.appendChild(label);

    this.#projectSelect = document.createElement("select");
    this.#projectSelect.className = "gallery-select";
    this.#projectSelect.addEventListener("change", () => {
      const val = this.#projectSelect!.value;
      this.#currentProjectId = val === "all" ? null : parseInt(val);
      this.#loadImages();
    });
    projectWrap.appendChild(this.#projectSelect);

    // Search input
    this.#searchInput = document.createElement("input");
    this.#searchInput.type = "text";
    this.#searchInput.placeholder = "Search...";
    this.#searchInput.className = "gallery-search";
    let searchTimeout: number;
    this.#searchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      searchTimeout = window.setTimeout(() => this.#loadImages(), 300);
    });

    // Insert before action buttons
    actions.insertBefore(this.#searchInput, actions.firstChild);
    actions.insertBefore(projectWrap, actions.firstChild);
  }

  async refresh(): Promise<void> {
    if (!isTauri) {
      this.#renderEmpty();
      return;
    }
    try {
      this.#projects = await listProjects();
      this.#renderProjectSelect();
      await this.#loadImages();
    } catch {
      this.#renderEmpty();
    }
  }

  #renderProjectSelect(): void {
    if (!this.#projectSelect) return;
    this.#projectSelect.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All projects";
    this.#projectSelect.appendChild(allOpt);

    for (const p of this.#projects) {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = `${p.name} (${p.image_count})`;
      this.#projectSelect.appendChild(opt);
    }
  }

  async #loadImages(): Promise<void> {
    if (!isTauri) return;
    try {
      const search = this.#searchInput?.value || undefined;
      this.#images = await listImages(
        this.#currentProjectId ?? undefined,
        search,
      );
      this.#renderGrid();
    } catch {
      this.#renderEmpty();
    }
  }

  #renderGrid(): void {
    this.#grid.innerHTML = "";

    if (this.#images.length === 0) {
      this.#renderEmpty();
      return;
    }

    for (const img of this.#images) {
      const item = document.createElement("div");
      item.className = "gallery-item";
      item.dataset.id = String(img.id);

      // Thumbnail
      const thumbEl = document.createElement("div");
      thumbEl.className = "gallery-thumb";
      if (img.thumbnail_path) {
        const imgEl = document.createElement("img");
        imgEl.alt = img.filename;
        imgEl.loading = "lazy";
        // Try asset protocol first, fallback to loading via Tauri command
        imgEl.src = this.#fileUrl(img.thumbnail_path);
        imgEl.onerror = () => {
          // Fallback: load via Tauri invoke
          loadScreenshot(img.thumbnail_path!).then((dataUrl) => {
            imgEl.src = dataUrl;
          }).catch(() => {});
        };
        thumbEl.appendChild(imgEl);
      } else {
        thumbEl.textContent = "No preview";
        thumbEl.style.cssText = "display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;background:#222;color:#666;font-size:12px;";
      }
      item.appendChild(thumbEl);

      // Info
      const info = document.createElement("div");
      info.className = "gallery-item-info";

      const name = document.createElement("div");
      name.className = "gallery-item-name";
      name.textContent = img.filename;
      info.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "gallery-item-meta";
      meta.textContent = `${img.width}\u00d7${img.height} \u2022 ${this.#formatDate(img.created_at)}`;
      info.appendChild(meta);

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.className = "gallery-item-delete";
      delBtn.textContent = "\u00d7";
      delBtn.title = "Delete";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.#deleteImage(img.id);
      });
      info.appendChild(delBtn);

      item.appendChild(info);

      // Click to open
      item.addEventListener("click", () => this.#openImage(img));

      this.#grid.appendChild(item);
    }
  }

  #renderEmpty(): void {
    this.#grid.innerHTML = `
      <div class="gallery-empty">
        <p>No screenshots yet.</p>
        <p>Use the Chrome extension to capture, or open an image file.</p>
      </div>`;
  }

  async #openImage(img: ImageInfo): Promise<void> {
    if (!this.onOpenImage) return;
    try {
      const dataUrl = await loadScreenshot(img.path);
      this.onOpenImage(dataUrl, img.width, img.height, img.id);
    } catch (err) {
      console.error("Failed to load image:", err);
    }
  }

  async #deleteImage(id: number): Promise<void> {
    try {
      await deleteImage(id);
      this.#images = this.#images.filter((i) => i.id !== id);
      this.#renderGrid();
    } catch (err) {
      console.error("Failed to delete image:", err);
    }
  }

  #fileUrl(path: string): string {
    // Tauri's asset protocol: each path segment must be encoded, but slashes preserved
    const normalized = path.replace(/\\/g, "/");
    const encoded = normalized.split("/").map(encodeURIComponent).join("/");
    return `https://asset.localhost/${encoded}`;
  }

  #formatDate(iso: string): string {
    if (!iso) return "";
    try {
      const d = new Date(iso + "Z");
      return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }
}
