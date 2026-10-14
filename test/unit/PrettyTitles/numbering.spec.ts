jest.mock("obsidian", () => {
    class TFile {
        path: string;
        basename: string;
        parent: { path: string };
        extension = "md";
    }
    class TFolder {
        path: string;
    }
    return {
        TFile,
        TFolder,
        getFrontMatterInfo: (text: string) => ({ exists: true, frontmatter: text }),
        parseYaml: JSON.parse,
    };
});
import { TFile, TFolder, Plugin } from "obsidian";
import { Numbering, initialOrder, numberedName, swapPosition } from "@src/PrettyTitles/Numbering";

function fixture() {
    const files: TFile[] = [],
        storage = new Map<string, string>(),
        meta = new Map<TFile, Record<string, unknown>>();
    const own = new Set<TFile>();
    let failAt = 0,
        calls = 0;
    const movePath = (file: TFile, path: string) => {
        file.path = path;
        file.basename = path.split("/").pop().slice(0, -3);
        file.parent = { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/" } as TFolder;
    };
    const add = (path: string, title?: string) => {
        const f = new TFile();
        movePath(f, path);
        files.push(f);
        meta.set(f, { ...(title === undefined ? {} : { title }), custom: "preserved" });
        return f;
    };
    const plugin = {
        manifest: { id: "pretty-titles" },
        app: {
            vault: {
                configDir: ".obsidian",
                getMarkdownFiles: () => files,
                getAllLoadedFiles: () => files,
                getAbstractFileByPath: (p: string) => files.find(f => f.path === p) ?? null,
                read: async (f: TFile) => JSON.stringify(meta.get(f)),
                adapter: {
                    exists: async (p: string) => storage.has(p),
                    read: async (p: string) => storage.get(p),
                    write: async (p: string, s: string) => {
                        storage.set(p, s);
                    },
                },
            },
            fileManager: {
                renameFile: async (f: TFile, p: string) => {
                    calls++;
                    if (failAt === calls) throw Error("simulated disk failure");
                    if (files.some(x => x !== f && x.path.toLowerCase() === p.toLowerCase())) throw Error("collision");
                    expect(own.has(f)).toBe(true);
                    movePath(f, p);
                },
                processFrontMatter: async (f: TFile, cb: (fm: Record<string, unknown>) => void) => cb(meta.get(f)),
            },
        },
    } as unknown as Plugin;
    const engine = () => new Numbering(plugin, own, () => {});
    return {
        files,
        storage,
        meta,
        own,
        add,
        movePath,
        engine,
        fail: (n: number) => {
            failAt = calls + n;
        },
    };
}

test("initial numeric order, duplicates, unnumbered notes and large prefixes", () => {
    const names = [
        "z",
        "2-b",
        "1-a",
        "2-a",
        "decimal-to-binary-conversion",
        "9007199254740994-a",
        "9007199254740993-a",
    ];
    expect(initialOrder(names.map(n => ({ path: n + ".md", basename: n }))).map(f => f.basename)).toEqual([
        "1-a",
        "2-a",
        "2-b",
        "9007199254740993-a",
        "9007199254740994-a",
        "decimal-to-binary-conversion",
        "z",
    ]);
});
test("numbered naming removes old prefix and punctuation", () =>
    expect(numberedName(0, "12-Analog: why? Yes.")).toBe("0-analog-why-yes.md"));
test("reorder boundaries are no-ops", () => {
    const a = ["a", "b"];
    expect(swapPosition(a, "a", -1)).toBe(false);
    expect(swapPosition(a, "b", 1)).toBe(false);
    expect(a).toEqual(["a", "b"]);
});

test("migrates per folder starting at zero, including root, and preserves titles", async () => {
    const f = fixture(),
        a = f.add("one/1-first.md", "First: why?"),
        b = f.add("one/2-second.md"),
        c = f.add("one/new.md"),
        d = f.add("root.md");
    await f.engine().apply();
    expect([a.path, b.path, c.path, d.path]).toEqual([
        "one/0-first-why.md",
        "one/1-second.md",
        "one/2-new.md",
        "0-root.md",
    ]);
    expect(f.meta.get(a)).toEqual({ title: "First: why?", custom: "preserved" });
});
test("append, title edits, duplicate titles, deletion and external prefix changes", async () => {
    const f = fixture(),
        n = f.engine(),
        a = f.add("one/1-a.md"),
        b = f.add("one/2-b.md");
    await n.apply();
    const c = f.add("one/Untitled.md");
    await n.apply();
    expect(c.basename).toBe("2-untitled");
    await n.apply(new Map([[c, "A"]]));
    expect(c.basename).toBe("2-a");
    f.files.splice(f.files.indexOf(b), 1);
    await n.apply();
    expect(c.basename).toBe("1-a");
    f.movePath(c, "one/99-a.md");
    await n.apply();
    expect(c.basename).toBe("1-a");
    expect(a.basename).toBe("0-a");
});
test("moves between folders append, folder renames preserve order", async () => {
    const f = fixture(),
        n = f.engine(),
        a = f.add("one/1-a.md"),
        b = f.add("one/2-b.md"),
        c = f.add("two/1-c.md");
    await n.apply();
    f.movePath(a, "two/0-a.md");
    await n.apply();
    expect(a.basename).toBe("1-a");
    expect(b.basename).toBe("0-b");
    const folder = new TFolder();
    folder.path = "renamed";
    f.movePath(c, "renamed/0-c.md");
    f.movePath(a, "renamed/1-a.md");
    n.folderRenamed(folder, "two");
    await n.apply();
    expect(c.path).toBe("renamed/0-c.md");
    expect(a.path).toBe("renamed/1-a.md");
});
test("reordering safely swaps duplicate titles and survives restart", async () => {
    const f = fixture(),
        n = f.engine(),
        a = f.add("one/1-a.md", "Same"),
        b = f.add("one/2-b.md", "Same");
    await n.apply();
    await n.move(b, -1);
    expect(b.path).toBe("one/0-same.md");
    expect(a.path).toBe("one/1-same.md");
    await f.engine().apply();
    expect(b.path).toBe("one/0-same.md");
});
test("restart keeps order, removes missing entries and appends offline additions", async () => {
    const f = fixture(),
        a = f.add("one/1-a.md"),
        b = f.add("one/2-b.md");
    await f.engine().apply();
    f.files.splice(f.files.indexOf(a), 1);
    const c = f.add("one/00-new.md");
    await f.engine().apply();
    expect(b.basename).toBe("0-b");
    expect(c.basename).toBe("1-new");
});
test("failed two-phase migration halts, survives restart, and recovers paths and metadata", async () => {
    const f = fixture(),
        n = f.engine(),
        a = f.add("one/1-a.md"),
        b = f.add("one/2-b.md", "B!");
    f.fail(3);
    await expect(n.apply()).rejects.toThrow("simulated");
    expect(n.halted).toBe(true);
    const restart = f.engine();
    await expect(restart.apply()).rejects.toThrow("interrompida");
    await restart.recover();
    expect(a.path).toBe("one/1-a.md");
    expect(b.path).toBe("one/2-b.md");
    expect(f.meta.get(a).title).toBeUndefined();
    expect(f.meta.get(b).title).toBe("B!");
    await restart.apply();
    expect(a.basename).toBe("0-a");
    expect(b.basename).toBe("1-b");
});
test("failed finalization can roll back even after some destinations are assigned", async () => {
    const f = fixture(),
        n = f.engine(),
        a = f.add("one/0-a.md", "A"),
        b = f.add("one/1-b.md", "B");
    await n.apply();
    f.fail(4);
    await expect(n.move(b, -1)).rejects.toThrow();
    await n.recover();
    expect(a.path).toBe("one/0-a.md");
    expect(b.path).toBe("one/1-b.md");
});
test("preflight validates all titles before renaming anything", async () => {
    const f = fixture(),
        a = f.add("one/1-a.md"),
        b = f.add("one/2-b.md", "???");
    await expect(f.engine().apply()).rejects.toThrow();
    expect(a.path).toBe("one/1-a.md");
    expect(b.path).toBe("one/2-b.md");
});
