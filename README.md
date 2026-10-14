# Pretty Titles

Fork of [Snezhig's Front Matter Title](https://github.com/snezhig/obsidian-front-matter-title), retaining the upstream source, history and GPL-3.0 license. Plugin ID: `pretty-titles`.

Edit a readable title in Obsidian's **native inline title**. Punctuation stays in the `title` property; the filename is always normalized to kebab-case on creation or change.

```yaml
---
title: "Analog vs. Digital: what's different?"
---
```

For a note at position `2` in its folder, the filename becomes `2-analog-vs-digital-whats-different.md`. Only the extension keeps a dot. No Markdown heading is inserted.

## Behavior

- Inline title: Enter, Tab or clicking away saves. Escape cancels. Paste inserts plain text. IME composition is respected.
- Property edits: changing `title` also normalizes the filename.
- File explorer / F2: renaming the filename rebuilds the readable title. A folder move preserves the custom title.
- Every Markdown note is numbered `0-`, `1-`, `2-`, … within its own folder (including the vault root). The prefix is omitted from the displayed/stored title. Numbers elsewhere are preserved.
- Existing titles keep their casing and punctuation. Notes without a title use a humanized filename as fallback.
- Filenames use lowercase letters, numbers and single hyphens. Spaces, underscores, symbols, emojis and punctuation become separators; periods and quotation marks are removed. Latin accents are folded (`ação` → `acao`); other scripts retain their letters and numbers.
- Notes with identical titles have distinct sequence numbers. Existing notes are never overwritten. Windows device names are prefixed with `note-`.
- Empty/punctuation-only names and filenames exceeding 240 UTF-8 bytes are rejected with a notice.
- Renames use Obsidian's `FileManager.renameFile`: enable **Automatically update internal links** to update links. Other frontmatter fields and the body are preserved, though Obsidian may reformat YAML.
- Only Markdown filenames are normalized. Folder names and attachments are left alone.
- Numbering is enforced at startup and after note creation, deletion, renaming, moves or title edits. New notes enter the end of the folder immediately (`N-untitled.md`); deleting a note closes the gap. Moving a note appends it to the destination and closes the source gap.
- **Mover nota uma posição acima/abaixo** commands change position and shift the neighboring note. Title edits and manual prefix edits do not change position; a manual prefix is corrected to the stored position. The commands work with hotkeys and Commander.
- Renaming a folder preserves the order of its notes. Folder names themselves, attachments and scripts are never numbered.
- The **Mostrar/ocultar propriedades** ribbon button and **Pretty Titles: Toggle properties visibility** command alternate the native global Visible/Hidden setting. The command can also be assigned to a hotkey or a Commander button.

The `title` property is the readable source of truth. A filename cannot reconstruct arbitrary punctuation: renaming it manually deliberately replaces the title with a filename-derived title. Edit the inline title or property when punctuation must be retained.

## Install

1. Disable the original **Front Matter Title** plugin (do not run both).
2. Download `main.js` and `manifest.json` from this fork's release.
3. Put both files in `<vault>/.obsidian/plugins/pretty-titles/`.
4. Reload Obsidian, then enable **Pretty Titles** in Community plugins.
5. Keep **Appearance → Show inline title** on. Inline display is enabled by default; other upstream display features are optional. The upstream Processor applies to those optional display features, not the synchronized inline title.

BRAT can also install `efpatti/obsidian-front-matter-title`.

## Existing-note migration and recovery

**Back up the vault before installing/upgrading to 4.4.0.** The first startup migrates all existing Markdown notes. For each folder it orders numbered notes by their existing numeric prefix (filename breaks ties), appends unnumbered notes alphabetically, then assigns a continuous sequence starting at zero. Subsequent startups retain persisted order, remove missing entries and append offline additions. File timestamps change.

The plugin stores paths/order in `numbering.json` beside `data.json`. Renames use a two-phase transaction through unique temporary names, with `numbering-journal.json` recording original, temporary and target paths before writes. A failed/interrupted transaction suspends numbering; **Recover interrupted numbering** restores original paths and title values through native renames. If external edits make recovery ambiguous or destinations occupied, restore the backup instead of overwriting notes. Uninstalling does not undo migration.

The live API remains available:

```js
// Returns a promise; work is serialized with automatic synchronization.
app.plugins.plugins['pretty-titles'].prettyTitles.normalizeAll()
// Most recent explicit/startup migration progress:
app.plugins.plugins['pretty-titles'].prettyTitles.migration
// Most recent transaction summary and old/target paths:
app.plugins.plugins['pretty-titles'].prettyTitles.numbering.lastReport
```

Native internal links follow Obsidian's **Automatically update internal links** setting. Filename-dependent integrations may need their configuration paths updated (homepage, templates and saved workspaces). Plugins that require a fixed naming scheme, such as date-only Daily Notes lookups, are not generally compatible with forced numeric filenames without an adapter; their lookup behavior is outside this plugin's numbering API.

## Development

```sh
git clone --recurse-submodules https://github.com/efpatti/obsidian-front-matter-title.git
cd obsidian-front-matter-title
npm ci
npm run build
npm test -- --runInBand --testPathPatterns=test/unit --coverage=false
```

`src/PrettyTitles/names.ts` defines normalization. `src/PrettyTitles/TitleSync.ts` handles events and the native inline title adapter. `Numbering.ts` handles ordering, transactions and recovery. Upstream display features remain available.

Run `python3 tools/numbering-smoke.py <vault-name>` against a **test vault** with this build enabled to exercise creation, inline editing, position commands, moves, folder renames, deletion, concurrent creation, restart, links and metadata. It creates a timestamped scratch folder and removes it on success; failed runs retain that folder for investigation.

Obsidian exposes no public API for editing the inline title independently of the filename. The DOM adapter and properties toggle use Obsidian internals and should be retested after app upgrades. Desktop integration is tested; mobile support is not yet verified.
