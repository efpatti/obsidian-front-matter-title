import subprocess,json,time
import sys
VAULT=sys.argv[1] if len(sys.argv)>1 else 'my-second-brain'
def ev(code):
 r=subprocess.run(['obsidian','vault='+VAULT,'eval','code='+code],capture_output=True,text=True,check=True).stdout.strip()
 if r.startswith('Error:'): raise AssertionError(r)
 return json.loads(r.removeprefix('=> '))
def wait():
 time.sleep(.35)
 ev('(async()=>{await app.plugins.plugins["pretty-titles"].prettyTitles.queue;return true;})()')
def check(code):
 r=ev(code)
 assert r is True,r
folder='pretty-titles-smoke-'+str(int(time.time()))+'/'
ev('(async()=>{await app.vault.createFolder('+json.dumps(folder.rstrip('/'))+');const f=await app.vault.create('+json.dumps(folder+'2-Untitled.md')+',"---\\ntags: [pretty-titles-test]\\ncustom: preserved\\n---\\n\\nBody stays exactly here.\\n");window.ptLeaf=app.workspace.getLeaf(true);await window.ptLeaf.openFile(f);window.ptTest=f;return true;})()')
wait()
ev('(()=>{const el=window.ptLeaf.view.inlineTitleEl;el.focus();el.textContent="Analog vs. Digital: why, how?";el.dispatchEvent(new InputEvent("input",{bubbles:true}));el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return true;})()')
wait()
check('(()=>{const v=window.ptLeaf.view;return v.inlineTitleEl.textContent==="Analog vs. Digital: why, how?";})()')
# Capture active test target and create an inbound wikilink.
ev('(async()=>{const f=window.ptTest;window.ptTest=f;await app.vault.create("'+folder+'link-test.md","[["+f.path+"|original caption]]\\n");return true;})()')
wait()
# Property changes drive filename updates.
ev('(async()=>{await app.fileManager.processFrontMatter(window.ptTest,fm=>{fm.title="Olá, mundo: API?";});return true;})()')
wait()
check('(async()=>{const f=window.ptTest;const text=await app.vault.read(f);const link=await app.vault.read(app.vault.getAbstractFileByPath("'+folder+'link-test.md"));return f.basename==="2-ola-mundo-api" && text.includes("custom: preserved") && text.endsWith("Body stays exactly here.\\n") && link.includes("2-ola-mundo-api") && link.includes("original caption");})()')
# Escape cancels the edit without changing content or name.
ev('(()=>{const el=window.ptLeaf.view.inlineTitleEl;el.focus();el.textContent="Discard: this?";el.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return true;})()')
wait()
check('window.ptTest.basename==="2-ola-mundo-api"')
# Two different titles can normalize to the same filename without overwrites.
ev('(async()=>{await app.vault.create("'+folder+'2-second.md","---\\ntitle: \\\"Olá, mundo: API?\\\"\\n---\\nSecond body\\n");return true;})()')
wait()
check('(async()=>{const f=app.vault.getAbstractFileByPath("'+folder+'2-ola-mundo-api-2.md");return !!f && (await app.vault.read(f)).endsWith("Second body\\n");})()')
# A filename rename is normalized, preserving the newly specified title punctuation.
ev('(async()=>{await app.fileManager.renameFile(window.ptTest,"'+folder+'2-External, name!.md");return true;})()')
wait()
check('(async()=>{const f=window.ptTest;return f.basename==="2-external-name" && (await app.vault.read(f)).includes("title: External, Name!");})()')
# Inline click/blur path, punctuation and structural prefix removal.
ev('(()=>{const el=window.ptLeaf.view.inlineTitleEl;el.focus();el.textContent="12-New: punctuation, periods. Questions?";el.dispatchEvent(new InputEvent("input",{bubbles:true}));el.blur();return true;})()')
wait()
check('(async()=>{const f=window.ptTest;return f.basename==="12-new-punctuation-periods-questions" && (await app.vault.read(f)).includes("title: \\\"New: punctuation, periods. Questions?\\\"") && window.ptLeaf.view.inlineTitleEl.textContent==="New: punctuation, periods. Questions?";})()')
print('PASS: inline Enter/blur, punctuation, property synchronization, native renames, prefix, collision suffix, Escape, links, metadata, body.')

# Dispose only the scratch folder this run created.
ev('(async()=>{window.ptLeaf.detach();const f=app.vault.getAbstractFileByPath('+json.dumps(folder.rstrip('/'))+');await app.vault.trash(f,true);delete window.ptTest;delete window.ptLeaf;return true;})()')
