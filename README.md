# Pretty Titles

Fork of [Snezhig's Front Matter Title](https://github.com/snezhig/obsidian-front-matter-title), retaining the upstream source, history and GPL-3.0 license. Plugin ID: `pretty-titles`.

Edit a readable title in Obsidian's **native inline title**. Punctuation stays in the `title` property; the filename is always normalized to kebab-case on creation or change.

```yaml
---
title: "Analog vs. Digital: what's different?"
---
```

For a note with prefix `2-`, the filename becomes `2-analog-vs-digital-whats-different.md`. Only the extension keeps a dot. No Markdown heading is inserted.

## Behavior

- Inline title: Enter, Tab or clicking away saves. Escape cancels. Paste inserts plain text. IME composition is respected.
- Property edits: changing `title` also normalizes the filename.
- File explorer / F2: renaming the filename rebuilds the readable title. A folder move preserves the custom title.
- Leading `12-` is structural numbering: preserved in the filename and omitted from the displayed/stored title. Numbers elsewhere are preserved.
- Existing titles keep their casing and punctuation. Notes without a title use a humanized filename as fallback.
- Filenames use lowercase letters, numbers and single hyphens. Spaces, underscores, symbols, emojis and punctuation become separators; periods and quotation marks are removed. Latin accents are folded (`ação` → `acao`); other scripts retain their letters and numbers.
- Collisions receive `-2`, `-3`, etc. Existing notes are never overwritten. Windows device names are prefixed with `note-`.
- Empty/punctuation-only names and filenames exceeding 240 UTF-8 bytes are rejected with a notice.
- Renames use Obsidian's `FileManager.renameFile`: enable **Automatically update internal links** to update links. Other frontmatter fields and the body are preserved, though Obsidian may reformat YAML.
- Only Markdown filenames are normalized. Folder names and attachments are left alone.
- Opening an existing note does not mutate it. Use **Pretty Titles: Normalize current note filename**, or the explicit migration API below, to migrate existing notes.
- The **Mostrar/ocultar propriedades** ribbon button and **Pretty Titles: Toggle properties visibility** command alternate the native global Visible/Hidden setting. The command can also be assigned to a hotkey or a Commander button.

The `title` property is the readable source of truth. A filename cannot reconstruct arbitrary punctuation: renaming it manually deliberately replaces the title with a filename-derived title. Edit the inline title or property when punctuation must be retained.

## Install

1. Disable the original **Front Matter Title** plugin (do not run both).
2. Download `main.js` and `manifest.json` from this fork's release.
3. Put both files in `<vault>/.obsidian/plugins/pretty-titles/`.
4. Reload Obsidian, then enable **Pretty Titles** in Community plugins.
5. Keep **Appearance → Show inline title** on. Inline display is enabled by default; other upstream display features are optional. The upstream Processor applies to those optional display features, not the synchronized inline title.

BRAT can also install `efpatti/obsidian-front-matter-title`.

## Existing-note migration

Back up the vault first, including original paths. With the plugin enabled, the Obsidian developer console or CLI can start an explicit migration:

```js
app.plugins.plugins['pretty-titles'].prettyTitles.normalizeAll()
```

Progress and individual failures are available at:

```js
app.plugins.plugins['pretty-titles'].prettyTitles.migration
```

Migration fills missing `title` properties, normalizes existing titles' structural prefixes, normalizes all Markdown filenames and updates links through Obsidian. It is serialized with other synchronization work and does not run at startup. File timestamps change. Uninstalling the plugin does not undo the migration; retain the backup if rollback is needed.

## Development

```sh
git clone --recurse-submodules https://github.com/efpatti/obsidian-front-matter-title.git
cd obsidian-front-matter-title
npm ci
npm run build
npm test -- --runInBand --testPathPatterns=test/unit --coverage=false
```

`src/PrettyTitles/names.ts` defines normalization. `src/PrettyTitles/TitleSync.ts` handles synchronization and the native inline title adapter. Upstream display features remain available.

Run `python3 tools/pretty-titles-smoke.py <vault-name>` against a **test vault** with this build enabled to exercise editing, property changes, collisions, cancellation, links and metadata. It creates a timestamped scratch folder and removes it on success; failed runs retain that folder for investigation.

Obsidian exposes no public API for editing the inline title independently of the filename. The DOM adapter and properties toggle use Obsidian internals and should be retested after app upgrades. Desktop integration is tested; mobile support is not yet verified.
