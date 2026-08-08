import os, shutil, zipfile

root = 'C:/Users/William Wang/Desktop/TalentNexus-104-Golden'
w = os.path.join(root, 'working')
cu = os.path.join(root, 'dist', 'chrome-extension', 'unpacked-ai-test')

# Remove existing unpacked dir (handle lock by ignoring errors on individual files)
if os.path.exists(cu):
    for dp, dns, fns in os.walk(cu, topdown=False):
        for f in fns:
            try: os.remove(os.path.join(dp, f))
            except Exception: pass
        for d in dns:
            try: os.rmdir(os.path.join(dp, d))
            except Exception: pass

os.makedirs(cu, exist_ok=True)
SKIP = {'.git', 'node_modules', 'test', '.DS_Store', 'dist'}
for name in os.listdir(w):
    if name in SKIP:
        continue
    s = os.path.join(w, name)
    d = os.path.join(cu, name)
    if os.path.isdir(s):
        shutil.copytree(s, d)
    else:
        shutil.copy2(s, d)

# Verify key artifacts present
checks = {
    'options.html': os.path.exists(os.path.join(cu, 'options.html')),
    'connector-options.js': os.path.exists(os.path.join(cu, 'connector-options.js')),
    'tnai.js': os.path.exists(os.path.join(cu, 'js/versions/v1/sites/tnai.js')),
}
b = open(os.path.join(cu, 'js/versions/v1/sites/tnai.js'), encoding='utf-8').read()
checks['_test absent'] = '_test' not in b
checks['guard present'] = '[^。，；！？]*\\s*@\\s*[^。，；！？]*[。.]' in b
checks['tn-shell css'] = '.tn-shell{' in b
checks['tn-resize handler'] = 'function mountShellResize' in b
checks['TN_UI dict'] = 'var TN_UI' in b
checks['no inline options script'] = '<script>' not in open(os.path.join(cu, 'options.html'), encoding='utf-8').read()

# Rebuild zip
zip_path = os.path.join(root, 'dist', 'chrome-extension', 'talent-nexus-connector-ai-test.zip')
if os.path.exists(zip_path):
    os.remove(zip_path)
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(cu):
        for f in files:
            fp = os.path.join(base, f)
            rel = os.path.relpath(fp, cu)
            z.writestr(rel, open(fp, 'rb').read().replace(b'\r\n', b'\n'))

# working==dist parity (normalized)
w_t = open(os.path.join(w, 'js/versions/v1/sites/tnai.js'), encoding='utf-8').read().replace('\r\n', '\n')
with zipfile.ZipFile(zip_path) as z:
    d_t = z.read('js/versions/v1/sites/tnai.js').decode('utf-8')
checks['working==zip parity'] = (w_t == d_t)
oh = open(os.path.join(cu, 'options.html'), encoding='utf-8').read()
checks['zip zh-TW preset'] = 'http://ats.talentnexus.com.tw:5679/' in oh
checks['zip en preset'] = 'http://ats-en.talentnexus.com.tw:5678/' in oh
checks['zip connector-options.js'] = 'connector-options.js' in oh

print('BUILD CHECKS:')
for k, v in checks.items():
    print(f'  {k}: {v}')
print('zip bytes:', os.path.getsize(zip_path))
