import { Component, MarkdownView, Notice, Plugin, TFile, TFolder } from "obsidian";
import { humanize, withoutPrefix } from "./names";

import { Numbering } from "./Numbering";

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
    public numbering: Numbering;
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
        this.numbering = new Numbering(this.plugin, this.own, (file, title) => {
            this.titles.set(file, title);
            this.known.set(file, title);
        });
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
                    if (file instanceof TFolder) {
                        this.numbering.folderRenamed(file, oldPath);
                        this.schedule(() => this.numbering.apply());
                        return;
                    }
                    if (!(file instanceof TFile) || file.extension !== "md" || this.own.has(file)) return;
                    const oldBase = oldPath.split("/").pop().replace(/\.md$/, "");
                    // Editing only the prefix must not discard custom punctuation or reorder the note.
                    const titleChanged = withoutPrefix(oldBase) !== withoutPrefix(file.basename);
                    const renamedTitle = titleChanged ? humanize(file.basename) : undefined;
                    this.schedule(() =>
                        this.numbering.apply(renamedTitle === undefined ? undefined : new Map([[file, renamedTitle]]))
                    );
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
            this.registerEvent(
                this.app.vault.on("delete", file => {
                    if (file instanceof TFolder || (file instanceof TFile && file.extension === "md"))
                        this.schedule(() => this.numbering.apply());
                })
            );
            this.schedule(() => this.normalizeAllNow());
            this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
            this.registerEvent(this.app.workspace.on("file-open", () => this.refresh()));
            this.refresh();
        });
        for (const delta of [-1, 1] as const)
            this.plugin.addCommand({
                id: delta === -1 ? "move-note-up" : "move-note-down",
                name: delta === -1 ? "Mover nota uma posição acima" : "Mover nota uma posição abaixo",
                callback: () => {
                    const file = this.app.workspace.getActiveFile();
                    if (file?.extension === "md")
                        this.schedule(async () => {
                            await this.numbering.move(file, delta);
                            this.refresh();
                        });
                },
            });
        this.plugin.addCommand({
            id: "recover-numbering",
            name: "Recover interrupted numbering",
            callback: () => this.schedule(() => this.numbering.recover()),
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

    /** Reconcile all folders; the same operation runs at startup. */
    public async normalizeAll(): Promise<void> {
        const work = this.queue.then(() => this.normalizeAllNow());
        this.queue = work.catch(error => {
            console.error(error);
        });
        await work;
    }

    private async normalizeAllNow(): Promise<void> {
        this.migration = { running: true, processed: 0, renamed: 0, errors: [] };
        try {
            await this.numbering.apply();
            this.migration.processed = this.numbering.lastReport.processed;
            this.migration.renamed = this.numbering.lastReport.renamed;
        } catch (error) {
            this.migration.errors.push(String(error));
            throw error;
        } finally {
            this.migration.running = false;
            this.refresh();
        }
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

    private async normalize(file: TFile): Promise<void> {
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
        await this.numbering.apply();
        this.refresh();
    }

    private async save(file: TFile, input: string): Promise<void> {
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
        await this.numbering.apply(new Map([[file, input]]));
        this.refresh();
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
