"""Package one verified build flavor; invoked by npm run package:dev or package:prod."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
flavors = parser.add_mutually_exclusive_group()
flavors.add_argument('--dev', action='store_true')
flavors.add_argument('--prod', action='store_true')
args = parser.parse_args()
channel = 'dev' if args.dev else 'prod'
root = Path.cwd()
dist = root / ('dist-dev' if args.dev else 'dist')
output = root / 'releases'
manifest = json.loads((dist / 'manifest.json').read_text())
version = manifest['version']
assert version == json.loads((root / 'package.json').read_text())['version'], 'Build version is stale.'
base_name = json.loads((root / 'manifest.json').read_text())['name']
assert manifest['name'] == (f'{base_name} Dev' if args.dev else base_name), 'Wrong build flavor.'
paths = [manifest['background']['service_worker'], manifest['side_panel']['default_path']]
for entry in manifest['content_scripts']:
    paths.extend(entry['js'])
for resource in manifest.get('web_accessible_resources', []):
    paths.extend(resource['resources'])
if 'offscreen' in manifest.get('permissions', []):
    paths.append('src/offscreen/index.html')
for path in paths:
    assert (dist / path).is_file(), path
assert 'modulepreload' not in (dist / manifest['side_panel']['default_path']).read_text()

# Check actual emitted code as well as the manifest: a renamed development
# bundle must never be published as production by accident.
code = '\n'.join(p.read_text() for p in dist.rglob('*.js'))
dev_controls = ['Text only (no images)', 'Masked copy (share-safe)',
                'Thread source (masked)', 'Thread source (original, private)',
                'Download saved file', 'Save locally', 'Choose downloaded file',
                'CAPTURE_THREAD_SOURCE']
for control in dev_controls:
    assert (control in code) == args.dev, f'{channel} build has incorrect developer control: {control}'

output.mkdir(exist_ok=True)
name = f'threadlens-{version}-{channel}'
archive = output / f'{name}.zip'
folder = output / name
flavor_note = (
    'Development testing package. Conversation exports, masked/original diagnostic captures, '
    'and local attachment save/import/download controls are enabled. '
    'Original diagnostic files contain email content; use the masked copy when reporting a problem.'
    if args.dev else
    'Production package. Conversation exports, diagnostic capture downloads and attachment '
    'save/import/download controls are not included. Attachment names and sizes are displayed; '
    'use the original email application to retrieve files. Inline images remain visible.'
)
install = f'''ThreadLens {version} ({channel})

{flavor_note}

Extract this ZIP. Open chrome://extensions, enable Developer mode, select Load unpacked,
and choose the extracted folder containing manifest.json.
For a source checkout, the matching build directory is {dist.name}/.
Reload an existing extension only if it already points to that directory.
Refresh Gmail/Outlook and reopen ThreadLens after installing or reloading.
Enable only one ThreadLens build on the same mailbox while testing.

Chrome 116 or later is required. All available quoted history is reconstructed locally;
history omitted by the sender cannot be recovered. Read collapsed emails and Collapse
emails again work in both builds. Existing downloaded exports do not change automatically.
'''
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(dist.rglob('*')):
        if p.is_file() and p.name != '.DS_Store':
            z.write(p, p.relative_to(dist))
    z.writestr('INSTALL.txt', install)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    if folder.exists():
        shutil.rmtree(folder)
    z.extractall(folder)
assert (folder / 'manifest.json').is_file()
(output / 'SHA256SUMS.txt').write_text(''.join(
    hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n'
    for p in sorted(output.glob('threadlens-*.zip'))))
print(f'Packaged {archive.name}: {archive.stat().st_size:,} bytes; flavor and manifest resources verified.')
print(f'::zip {archive}')
print(f'::folder {folder}')
print(f'::sha256 {hashlib.sha256(archive.read_bytes()).hexdigest()}')
