import { Component, MarkdownView, Notice, Plugin, TFile, getFrontMatterInfo, parseYaml } from "obsidian";
import { humanize, prefixOf, slugify, withoutPrefix } from "./names";

type View = MarkdownView & { inlineTitleEl: HTMLElement };
type Binding = { view: View; cleanup: () => void };

/** UI adapters are isolated here: Obsidian has no public inline-title editing API. */
export default class TitleSync extends Component {
    private bindings = new Map<HTMLElement, Binding>();
    private editing = new Map<HTMLElement, { file: TFile; original: string }>();
    private titles = new WeakMap<TFile, string>();
    private known = new WeakMap<TFile, unknown>();
    private own = new Set<TFile>();
    private queue: Promise<unknown> = Promise.resolve();
    private stopped = false;
    public migration: { running: boolean; processed: number; renamed: number; errors: string[] } = {
        running: false,
        processed: 0,
        renamed: 0,
        errors: [],
    };

    constructor(
        private plugin: Plugin,
        private inlineEnabled: () => boolean
    ) {
        super();
    }
    private get app() {
        return this.plugin.app;
    }

    onload(): void {
        this.app.workspace.onLayoutReady(() => {
            if (this.stopped) return;
            for (const file of this.app.vault.getMarkdownFiles()) {
                this.known.set(file, this.app.metadataCache.getFileCache(file)?.frontmatter?.title);
            }
            this.registerEvent(
                this.app.vault.on("create", file => {
                    if (file instanceof TFile && file.extension === "md") this.schedule(() => this.normalize(file));
                })
            );
            this.registerEvent(
                this.app.vault.on("rename", (file, oldPath) => {
                    if (!(file instanceof TFile) || file.extension !== "md" || this.own.has(file)) return;
                    const oldBase = oldPath.split("/").pop().replace(/\.md$/, "");
                    // Folder moves do not change the title; actual filename edits do.
                    this.schedule(() => this.normalize(file, oldBase !== file.basename));
                })
            );
            this.registerEvent(
                this.app.metadataCache.on("changed", (file, _, cache) => {
                    const next = cache.frontmatter?.title;
                    const previous = this.known.get(file);
                    this.known.set(file, next);
                    if (typeof next === "string") this.titles.set(file, next);
                    else this.titles.delete(file);
                    this.refresh();
                    if (!this.own.has(file) && next !== previous && typeof next === "string") {
                        this.schedule(() => this.normalize(file));
                    }
                })
            );
            this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
            this.registerEvent(this.app.workspace.on("file-open", () => this.refresh()));
            this.refresh();
        });
        this.plugin.addCommand({
            id: "normalize-current-title",
            name: "Normalize current note filename",
            callback: () => {
                const file = this.app.workspace.getActiveFile();
                if (file?.extension === "md") this.schedule(() => this.normalize(file));
            },
        });
    }

    /** Explicit migration: never run automatically at startup. Caller should back up first. */
    public async normalizeAll(): Promise<void> {
        if (this.migration.running) return;
        this.migration = { running: true, processed: 0, renamed: 0, errors: [] };
        const work = this.queue
            .then(async () => {
                const files = this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
                for (const file of files) {
                    if (this.stopped) break;
                    const before = file.path;
                    try {
                        await this.normalize(file);
                        if (file.path !== before) this.migration.renamed++;
                    } catch (error) {
                        this.migration.errors.push(`${before}: ${error.message}`);
                    }
                    this.migration.processed++;
                }
            })
            .finally(() => {
                this.migration.running = false;
            });
        this.queue = work.catch(console.error);
        await work;
    }

    private schedule(action: () => Promise<void>): void {
        this.queue = this.queue
            .then(async () => {
                if (!this.stopped) await action();
            })
            .catch(error => {
                console.error("Pretty Titles", error);
                new Notice(`Pretty Titles: ${error.message}`);
            });
    }

    private async readTitle(file: TFile): Promise<string | undefined> {
        const text = await this.app.vault.read(file);
        const info = getFrontMatterInfo(text);
        const value = info.exists ? parseYaml(info.frontmatter)?.title : undefined;
        return typeof value === "string" && value.trim() ? value : undefined;
    }

    private async normalize(file: TFile, renamed = false): Promise<void> {
        if (!this.app.vault.getAbstractFileByPath(file.path)) return;
        const stored = await this.readTitle(file);
        const prefix = prefixOf(file.basename);
        // Keep punctuation when a rename only moved the file or normalized its existing slug.
        const sameSlug = stored && file.basename === prefix + slugify(withoutPrefix(stored));
        const title = renamed && !sameSlug ? humanize(file.basename) : (stored ?? humanize(file.basename));
        await this.save(file, title);
    }

    private destination(file: TFile, title: string, prefix: string): string {
        const stem = prefix + slugify(title);
        const folder = file.parent?.path === "/" ? "" : `${file.parent?.path ?? ""}/`;
        const occupied = new Set(
            this.app.vault
                .getFiles()
                .filter(f => f !== file)
                .map(f => f.path.toLowerCase())
        );
        for (let i = 1; ; i++) {
            const name = `${stem}${i === 1 ? "" : `-${i}`}.md`;
            if (new TextEncoder().encode(name).length > 240)
                throw new Error("Título longo demais para o filename (limite de 240 bytes). Encurte o título.");
            const path = folder + name;
            if (!occupied.has(path.toLowerCase())) return path;
        }
    }

    private async save(file: TFile, input: string): Promise<void> {
        const title = withoutPrefix(input.replace(/[\r\n\t]+/g, " "));
        const prefix = prefixOf(input) || prefixOf(file.basename);
        const path = this.destination(file, title, prefix);
        const oldPath = file.path;
        const stored = await this.readTitle(file);
        this.own.add(file);
        try {
            // Native rename updates links and respects the user's Obsidian link settings.
            if (path !== file.path) await this.app.fileManager.renameFile(file, path);
            try {
                if (stored !== title)
                    await this.app.fileManager.processFrontMatter(file, fm => {
                        fm.title = title;
                    });
            } catch (error) {
                if (file.path !== oldPath && !this.app.vault.getAbstractFileByPath(oldPath)) {
                    await this.app.fileManager.renameFile(file, oldPath);
                }
                throw error;
            }
            this.titles.set(file, title);
            this.known.set(file, title);
        } finally {
            this.own.delete(file);
            this.refresh();
        }
    }

    private display(file: TFile): string {
        const stored = this.titles.get(file) ?? this.app.metadataCache.getFileCache(file)?.frontmatter?.title;
        return typeof stored === "string" && stored.trim() ? withoutPrefix(stored) : humanize(file.basename);
    }

    refresh(): void {
        if (this.stopped) return;
        const live = new Set<HTMLElement>();
        this.app.workspace.iterateAllLeaves(leaf => {
            if (!(leaf.view instanceof MarkdownView)) return;
            const view = leaf.view as View;
            const el = view.inlineTitleEl;
            if (!el || !view.file) return;
            live.add(el);
            if (this.editing.has(el) && this.editing.get(el).file !== view.file) this.editing.delete(el);
            if (!this.bindings.has(el)) this.bind(el, view);
            if (!this.editing.has(el)) {
                const text = this.inlineEnabled() ? this.display(view.file) : view.file.basename;
                if (el.textContent !== text) el.textContent = text;
            }
        });
        for (const [el, binding] of this.bindings)
            if (!live.has(el)) {
                binding.cleanup();
                this.bindings.delete(el);
                this.editing.delete(el);
            }
    }

    private bind(el: HTMLElement, view: View): void {
        const focus = (event?: Event) => {
            if (event && event.target !== el) return;
            if (!this.inlineEnabled() || !view.file) return;
            const title = this.display(view.file);
            el.textContent = title;
            this.editing.set(el, { file: view.file, original: title });
        };
        const blur = (event: Event) => {
            if (event.target !== el) return;
            if (!this.inlineEnabled()) return;
            event.stopImmediatePropagation(); // Never pass a human title to native filename validation.
            const edit = this.editing.get(el);
            this.editing.delete(el);
            const input = el.textContent ?? "";
            if (edit && input.trim() && input !== edit.original) this.schedule(() => this.save(edit.file, input));
            this.refresh();
        };
        const input = (event: Event) => {
            if (event.target !== el) return;
            if (this.inlineEnabled()) {
                if (!this.editing.has(el) && view.file)
                    this.editing.set(el, { file: view.file, original: this.display(view.file) });
                event.stopImmediatePropagation();
            }
        };
        const keydown = (event: KeyboardEvent) => {
            if (event.target !== el) return;
            if (!this.inlineEnabled() || event.isComposing) return;
            // The native Enter handler calls saveTitle directly, before blur.
            if (["Enter", "Escape", "Tab"].includes(event.key)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (event.key === "Escape") this.editing.delete(el);
                el.blur();
                view.editor?.focus();
            }
        };
        const paste = (event: ClipboardEvent) => {
            if (event.target !== el) return;
            if (!this.inlineEnabled()) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const text = event.clipboardData?.getData("text/plain").replace(/[\r\n\t]+/g, " ") ?? "";
            el.ownerDocument.execCommand("insertText", false, text);
        };
        view.containerEl.addEventListener("focus", focus, true);
        view.containerEl.addEventListener("blur", blur, true);
        view.containerEl.addEventListener("input", input, true);
        view.containerEl.addEventListener("keydown", keydown, true);
        view.containerEl.addEventListener("paste", paste, true);
        const Observer = el.ownerDocument.defaultView.MutationObserver;
        const observer = new Observer(() => this.refresh());
        observer.observe(el, { childList: true, characterData: true, subtree: true });
        this.bindings.set(el, {
            view,
            cleanup: () => {
                observer.disconnect();
                view.containerEl.removeEventListener("focus", focus, true);
                view.containerEl.removeEventListener("blur", blur, true);
                view.containerEl.removeEventListener("input", input, true);
                view.containerEl.removeEventListener("keydown", keydown, true);
                view.containerEl.removeEventListener("paste", paste, true);
                if (view.file) el.textContent = view.file.basename;
            },
        });
        if (el === el.ownerDocument.activeElement) focus();
    }

    onunload(): void {
        this.stopped = true;
        for (const binding of this.bindings.values()) binding.cleanup();
        this.bindings.clear();
        this.editing.clear();
    }
}
