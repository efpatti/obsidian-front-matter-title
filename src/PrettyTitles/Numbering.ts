import { TFile, TFolder, Plugin, getFrontMatterInfo, parseYaml } from "obsidian";
import { humanize, slugify, withoutPrefix } from "./names";

export function initialOrder<T extends { path: string; basename: string }>(files: T[]): T[] {
    return [...files].sort((a, b) => {
        const an = a.basename.match(/^(\d+)-/),
            bn = b.basename.match(/^(\d+)-/);
        if (!!an !== !!bn) return an ? -1 : 1;
        if (an && bn && BigInt(an[1]) !== BigInt(bn[1])) return BigInt(an[1]) < BigInt(bn[1]) ? -1 : 1;
        return a.basename.localeCompare(b.basename, "en", { numeric: true }) || a.path.localeCompare(b.path, "en");
    });
}

export function numberedName(index: number, title: string): string {
    const name = `${index}-${slugify(withoutPrefix(title))}.md`;
    if (new TextEncoder().encode(name).length > 240)
        throw new Error("Título longo demais para o filename (240 bytes).");
    return name;
}

export function swapPosition<T>(list: T[], item: T, delta: -1 | 1): boolean {
    const i = list.indexOf(item),
        j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    return true;
}

type OrderState = { version: 1; folders: Record<string, string[]> };
type Change = {
    old: string;
    temporary: string;
    target: string;
    current: string;
    pending?: string;
    title: string;
    previousTitle?: unknown;
    hadTitle: boolean;
};
type Journal = {
    version: 1;
    id: string;
    status: "running" | "complete" | "failed" | "rolled-back";
    changes: Change[];
    error?: string;
    originalOrder: OrderState;
};

/** File objects preserve identity across native renames; persisted paths restore order at restart. */
export class Numbering {
    private groups = new Map<string, TFile[]>();
    private initialized = false;
    public halted = false;
    public lastReport: { processed: number; renamed: number; changes: { old: string; target: string }[] };
    private statePath: string;
    private journalPath: string;
    constructor(
        private plugin: Plugin,
        private own: Set<TFile>,
        private saved: (file: TFile, title: string) => void
    ) {
        const folder = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
        this.statePath = `${folder}/numbering.json`;
        this.journalPath = `${folder}/numbering-journal.json`;
    }
    private get app() {
        return this.plugin.app;
    }
    private folder(file: TFile) {
        return file.parent?.path ?? "/";
    }
    private join(folder: string, name: string) {
        return folder === "/" ? name : `${folder}/${name}`;
    }
    private state(): OrderState {
        return {
            version: 1,
            folders: Object.fromEntries([...this.groups].map(([folder, files]) => [folder, files.map(f => f.path)])),
        };
    }
    private async write(path: string, data: unknown) {
        await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    }
    private async load<T>(path: string): Promise<T | null> {
        return (await this.app.vault.adapter.exists(path)) ? JSON.parse(await this.app.vault.adapter.read(path)) : null;
    }
    private async metadata(file: TFile): Promise<Record<string, unknown>> {
        const info = getFrontMatterInfo(await this.app.vault.read(file));
        return info.exists ? (parseYaml(info.frontmatter) ?? {}) : {};
    }
    async initialize(): Promise<void> {
        if (this.initialized) return;
        const journal = await this.load<Journal>(this.journalPath);
        if (journal && ["running", "failed"].includes(journal.status)) {
            this.halted = true;
            throw new Error("Numeração interrompida. Use 'Recover interrupted numbering' antes de continuar.");
        }
        const state = await this.load<OrderState>(this.statePath);
        if (state && state.version !== 1) throw new Error("Versão desconhecida do estado de numeração.");
        const all = this.app.vault.getMarkdownFiles();
        const folders = new Set(all.map(f => this.folder(f)));
        for (const folder of folders) {
            const files = all.filter(f => this.folder(f) === folder);
            const prior = state?.folders[folder];
            const byPath = new Map(files.map(f => [f.path, f]));
            const kept = (prior ?? []).map(path => byPath.get(path)).filter(Boolean);
            const added = files.filter(f => !kept.includes(f));
            this.groups.set(
                folder,
                prior ? [...kept, ...added.sort((a, b) => a.path.localeCompare(b.path, "en"))] : initialOrder(files)
            );
        }
        this.initialized = true;
    }
    /** Used synchronously by the native folder-rename listener, before any queued work. */
    folderRenamed(folder: TFolder, old: string): void {
        for (const [key, files] of [...this.groups]) {
            if (key === old || key.startsWith(old + "/")) {
                this.groups.delete(key);
                this.groups.set(folder.path + key.slice(old.length), files);
            }
        }
    }
    private reconcile(): void {
        const all = this.app.vault.getMarkdownFiles(),
            live = new Set(all);
        const moving: TFile[] = [];
        for (const [folder, files] of this.groups) {
            for (const file of files) if (live.has(file) && this.folder(file) !== folder) moving.push(file);
            this.groups.set(
                folder,
                files.filter(f => live.has(f) && this.folder(f) === folder)
            );
        }
        for (const file of [...moving, ...all]) {
            const folder = this.folder(file);
            if (!this.groups.has(folder)) this.groups.set(folder, []);
            const list = this.groups.get(folder);
            if (!list.includes(file)) list.push(file);
        }
        for (const [folder, files] of this.groups) if (!files.length) this.groups.delete(folder);
    }
    async move(file: TFile, delta: -1 | 1): Promise<void> {
        await this.initialize();
        this.reconcile();
        if (swapPosition(this.groups.get(this.folder(file)) ?? [], file, delta)) await this.apply();
    }
    async apply(overrides = new Map<TFile, string>()): Promise<void> {
        await this.initialize();
        if (this.halted) throw new Error("Numeração suspensa após erro; use o comando de recuperação.");
        this.reconcile();
        const originalOrder = (await this.load<OrderState>(this.statePath)) ?? this.state();
        const changes: Change[] = [],
            refs = new Map<Change, TFile>();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        let processed = 0;
        // Validate the entire transaction before changing any files.
        for (const [folder, files] of this.groups) {
            for (const [index, file] of files.entries()) {
                processed++;
                const fm = await this.metadata(file);
                const stored = typeof fm.title === "string" && fm.title.trim() ? fm.title : undefined;
                const title = withoutPrefix(
                    (overrides.get(file) ?? stored ?? humanize(file.basename)).replace(/[\r\n\t]+/g, " ")
                );
                const target = this.join(folder, numberedName(index, title));
                if (file.path === target && fm.title === title) {
                    this.saved(file, title);
                    continue;
                }
                const temporary = this.join(folder, `pretty-titles-tmp-${id}-${changes.length}.md`);
                if (this.app.vault.getAbstractFileByPath(temporary)) throw new Error("Nome temporário ocupado.");
                const change: Change = {
                    old: file.path,
                    current: file.path,
                    temporary,
                    target,
                    title,
                    previousTitle: fm.title,
                    hadTitle: Object.prototype.hasOwnProperty.call(fm, "title"),
                };
                changes.push(change);
                refs.set(change, file);
            }
        }
        const participants = new Set([...refs.values()]);
        const targets = new Set<string>();
        const occupied = new Set(
            this.app.vault
                .getAllLoadedFiles()
                .filter(f => !participants.has(f as TFile))
                .map(f => f.path.toLowerCase())
        );
        for (const c of changes) {
            if (targets.has(c.target.toLowerCase()) || occupied.has(c.target.toLowerCase()))
                throw new Error(`Destino ocupado: ${c.target}`);
            targets.add(c.target.toLowerCase());
        }
        this.lastReport = {
            processed,
            renamed: changes.filter(c => c.old !== c.target).length,
            changes: changes.filter(c => c.old !== c.target).map(c => ({ old: c.old, target: c.target })),
        };
        if (!changes.length) {
            await this.write(this.statePath, this.state());
            return;
        }
        const journal: Journal = { version: 1, id, status: "running", changes, originalOrder };
        await this.write(this.journalPath, journal);
        for (const f of participants) this.own.add(f);
        const rename = async (c: Change, path: string) => {
            if (c.current === path) return;
            c.pending = path;
            await this.write(this.journalPath, journal);
            await this.app.fileManager.renameFile(refs.get(c), path);
            c.current = path;
            delete c.pending;
            await this.write(this.journalPath, journal);
        };
        try {
            for (const c of changes) if (c.old !== c.target) await rename(c, c.temporary);
            for (const c of changes) if (c.old !== c.target) await rename(c, c.target);
            for (const c of changes) {
                if (c.previousTitle !== c.title)
                    await this.app.fileManager.processFrontMatter(refs.get(c), fm => {
                        fm.title = c.title;
                    });
                this.saved(refs.get(c), c.title);
            }
            await this.write(this.statePath, this.state());
            journal.status = "complete";
            await this.write(this.journalPath, journal);
        } catch (error) {
            this.halted = true;
            journal.status = "failed";
            journal.error = String(error);
            await this.write(this.journalPath, journal);
            throw error;
        } finally {
            for (const f of participants) this.own.delete(f);
        }
    }
    /** Explicit rollback through native renames so link changes are rolled back too. */
    async recover(): Promise<void> {
        const journal = await this.load<Journal>(this.journalPath);
        if (!journal || !["running", "failed"].includes(journal.status)) return;
        const refs = new Map<Change, TFile>();
        for (const c of journal.changes) {
            const file =
                this.app.vault.getAbstractFileByPath(c.pending ?? c.current) ??
                this.app.vault.getAbstractFileByPath(c.current);
            if (!(file instanceof TFile))
                throw new Error(`Não foi possível localizar ${c.current}. Restaure o backup.`);
            if ([...refs.values()].includes(file)) throw new Error("Recuperação ambígua; restaure o backup.");
            refs.set(c, file);
        }
        for (const file of refs.values()) this.own.add(file);
        const rename = async (c: Change, path: string) => {
            const file = refs.get(c);
            if (file.path === path) return;
            const occupied = this.app.vault.getAbstractFileByPath(path);
            if (occupied && occupied !== file) throw new Error(`Recuperação bloqueada: ${path}`);
            c.pending = path;
            await this.write(this.journalPath, journal);
            await this.app.fileManager.renameFile(file, path);
            c.current = path;
            delete c.pending;
            await this.write(this.journalPath, journal);
        };
        try {
            for (const c of journal.changes) await rename(c, c.temporary);
            for (const c of journal.changes) await rename(c, c.old);
            for (const c of journal.changes)
                await this.app.fileManager.processFrontMatter(refs.get(c), fm => {
                    if (c.hadTitle) fm.title = c.previousTitle;
                    else delete fm.title;
                });
            await this.write(this.statePath, journal.originalOrder);
            journal.status = "rolled-back";
            await this.write(this.journalPath, journal);
            this.groups.clear();
            this.initialized = false;
            this.halted = false;
        } finally {
            for (const file of refs.values()) this.own.delete(file);
        }
    }
}
