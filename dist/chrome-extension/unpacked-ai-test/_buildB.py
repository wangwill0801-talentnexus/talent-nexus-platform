import os, shutil, zipfile

root = 'C:/Users/William Wang/Desktop/TalentNexus-104-Golden'
w = os.path.join(root, 'working')
cu = os.path.join(root, 'dist', 'chrome-extension', 'unpacked-ai-test')

if os.path.exists(cu):
    for dp, dns, fns in os.walk(cu, topdown=False):
        for f in fns:
            try: os.remove(os.path.join(dp, f))
            except Exception: pass
        for d in dns:
            try: os.rmdir(os.path.join(dp, d))
            except Exception: pass
os.makedirs(cu, exist_ok=True)
SKIP = {'.git','node_modules','test','.DS_Store','dist'}
for name in os.listdir(w):
    if name in SKIP: continue
    s = os.path.join(w, name); d = os.path.join(cu, name)
    if os.path.isdir(s): shutil.copytree(s, d)
    else: shutil.copy2(s, d)

b = open(os.path.join(cu, 'js/versions/v1/sites/tnai.js'), encoding='utf-8').read()
checks = {
  'no .tn-shell': '.tn-shell' not in b,
  'resize on .bg-write': "root.querySelector('.bg-write')" in b,
  'no resize on .bg': 'root.parentNode' not in b[b.find('function mountShellResize'):b.find('function removeNewTalentTheme')],
  'inline !important on card': "card.style.setProperty('width', '560px', 'important')" in b,
  'glass rgba': 'rgba(225, 241, 255, 0.72)' in b,
  'backdrop-filter': 'backdrop-filter' in b,
  'overflow-x hidden': "setProperty('overflow-x', 'hidden'" in b,
  'no _test': '_test' not in b,
  'no diag overlay': 'tnai-b2-diag' not in b,
  'subtitle fix': 'padding: 6px 16px 8px;font:500 11px/1.3 system-ui' in b,
}
wt = open(os.path.join(w,'js/versions/v1/sites/tnai.js'),encoding='utf-8').read().replace('\r\n','\n')
checks['working==dist parity'] = (wt == b.replace('\r\n','\n'))

zip_path = os.path.join(root,'dist','chrome-extension','talent-nexus-connector-ai-test.zip')
if os.path.exists(zip_path): os.remove(zip_path)
zf = zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED)
names = []
for base,_,files in os.walk(cu):
    for f in files:
        fp=os.path.join(base,f)
        rel=os.path.relpath(fp,cu).replace(os.sep,'/')
        names.append(rel)
        zf.writestr(rel, open(fp,'rb').read().replace(b'\r\n',b'\n'))
zf.close()
with zipfile.ZipFile(zip_path) as z:
    zb = z.read('js/versions/v1/sites/tnai.js').decode('utf-8')
checks['zip no _test'] = '_test' not in zb
checks['zip bg-write resize'] = "root.querySelector('.bg-write')" in zb
checks['zip glass'] = 'rgba(225, 241, 255, 0.72)' in zb

print('BUILD CHECKS:')
for k,v in checks.items(): print(f'  {k}: {v}')
print('zip bytes:', os.path.getsize(zip_path))
