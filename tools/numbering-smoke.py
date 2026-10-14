"""Run against a test vault with Pretty Titles 4.4 enabled. No existing note is edited."""
import json
import subprocess
import sys
import time

vault = sys.argv[1]
folder = 'pretty-numbering-test-' + str(int(time.time()))

def cli(*args):
    result = subprocess.run(['obsidian', 'vault=' + vault, *args], capture_output=True, text=True, check=True).stdout.strip()
    if result.startswith('Error:'):
        raise AssertionError(result)
    return result

def ev(code):
    return json.loads(cli('eval', 'code=(async()=>JSON.stringify(await (' + code + ')))()').removeprefix('=> '))

def settle():
    time.sleep(.2)
    ev('(async()=>{await app.plugins.plugins["pretty-titles"].prettyTitles.queue;return true;})()')
    time.sleep(.1)
    ev('(async()=>{await app.plugins.plugins["pretty-titles"].prettyTitles.queue;return true;})()')

def check(code):
    result = ev(code)
    assert result is True, result

base = json.dumps(folder)
ev('(async()=>{const folder=' + base + ';if(app.vault.getAbstractFileByPath(folder))throw Error("Folder exists");await app.vault.createFolder(folder);await app.vault.createFolder(folder+"/a");await app.vault.createFolder(folder+"/b");window.numberTest={folder,original:app.workspace.activeLeaf};return true;})()')
ev('(async()=>{const t=window.numberTest;t.a=await app.vault.create(t.folder+"/a/Alpha.md",\'---\\ntitle: "Alpha: value?"\\ncustom: preserved\\n---\\nBody A\\n\');t.b=await app.vault.create(t.folder+"/a/Beta.md","Body B\\n");return true;})()')
settle()
check('window.numberTest.a.basename==="0-alpha-value" && window.numberTest.b.basename==="1-beta"')
ev('(async()=>{const t=window.numberTest;t.link=await app.vault.create(t.folder+"/b/Reference.md","[["+t.a.path+"|caption]]\\n");t.c=await app.vault.create(t.folder+"/a/Untitled.md", "Body C\\n");t.leaf=app.workspace.getLeaf(true);await t.leaf.openFile(t.c);return true;})()')
settle()
check('window.numberTest.c.basename==="2-untitled"')
ev('(()=>{const el=window.numberTest.leaf.view.inlineTitleEl;el.focus();el.textContent="Decimal-to-Binary Conversion";el.dispatchEvent(new InputEvent("input",{bubbles:true}));el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return true;})()')
settle()
check('window.numberTest.c.basename==="2-decimal-to-binary-conversion"')
cli('command', 'id=pretty-titles:move-note-up')
settle()
check('window.numberTest.c.basename==="1-decimal-to-binary-conversion" && window.numberTest.b.basename==="2-beta"')
ev('(async()=>{const t=window.numberTest;await app.fileManager.renameFile(t.c,t.folder+"/a/99-decimal-to-binary-conversion.md");return true;})()')
settle()
check('window.numberTest.c.basename==="1-decimal-to-binary-conversion"')
ev('(async()=>{const t=window.numberTest;await app.fileManager.renameFile(t.a,t.folder+"/b/"+t.a.name);return true;})()')
settle()
check('(async()=>{const t=window.numberTest;return t.c.basename==="0-decimal-to-binary-conversion"&&t.b.basename==="1-beta"&&t.a.basename==="1-alpha-value"&&(await app.vault.read(t.link)).includes("1-alpha-value")&&(await app.vault.read(t.a)).includes("custom: preserved");})()')
ev('(async()=>{const t=window.numberTest;await app.fileManager.renameFile(app.vault.getAbstractFileByPath(t.folder+"/a"),t.folder+"/renamed");await app.fileManager.processFrontMatter(t.b,fm=>{fm.title="Beta, revised?";});return true;})()')
settle()
check('window.numberTest.b.path.endsWith("/renamed/1-beta-revised.md") && window.numberTest.c.path.endsWith("/renamed/0-decimal-to-binary-conversion.md")')
ev('(async()=>{const t=window.numberTest;await app.vault.trash(t.c,true);return true;})()')
settle()
check('window.numberTest.b.basename==="0-beta-revised"')
ev('(async()=>{const t=window.numberTest;await Promise.all([app.vault.create(t.folder+"/renamed/New A.md","A"),app.vault.create(t.folder+"/renamed/New B.md","B")]);return true;})()')
settle()
check('(()=>{const t=window.numberTest;const names=app.vault.getMarkdownFiles().filter(f=>f.parent.path===t.folder+"/renamed").map(f=>Number(f.basename.split("-")[0])).sort();return JSON.stringify(names)==="[0,1,2]";})()')
ev('(()=>{window.numberTest.snapshot=app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(window.numberTest.folder+"/")).map(f=>f.path).sort();return true;})()')
cli('plugin:reload','id=pretty-titles')
settle()
check('JSON.stringify(window.numberTest.snapshot)===JSON.stringify(app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(window.numberTest.folder+"/")).map(f=>f.path).sort())')
ev('(async()=>{const t=window.numberTest;t.leaf.detach();app.workspace.setActiveLeaf(t.original,{focus:true});await app.vault.trash(app.vault.getAbstractFileByPath(t.folder),true);delete window.numberTest;return true;})()')
settle()
print('PASS: creation, inline rename, position command, prefix correction, moves, folder rename, property sync, delete compaction, simultaneous creation, restart, links, metadata.')
