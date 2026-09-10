"""Package an already-built local extension; run through npm run package."""
from pathlib import Path
import json, zipfile, hashlib
root=Path.cwd(); dist=root/'dist'; output=root/'releases'; output.mkdir(exist_ok=True)
manifest=json.loads((dist/'manifest.json').read_text()); version=manifest['version']; assert version==json.loads((root/'package.json').read_text())['version']
paths=[manifest['background']['service_worker'],manifest['side_panel']['default_path']]
for entry in manifest['content_scripts']: paths.extend(entry['js'])
for resource in manifest.get('web_accessible_resources',[]): paths.extend(resource['resources'])
if 'offscreen' in manifest.get('permissions', []): paths.append('src/offscreen/index.html')
for path in paths: assert (dist/path).is_file(), path
assert 'modulepreload' not in (dist/manifest['side_panel']['default_path']).read_text()
archive=output/f'threadlens-{version}.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(dist.rglob('*')):
  if p.is_file() and p.name!='.DS_Store': z.write(p,p.relative_to(dist))
 z.writestr('INSTALL.txt',f'ThreadLens {version}\n\nExtract this ZIP. Open chrome://extensions, enable Developer mode, click Load unpacked, and select the extracted folder containing manifest.json. If using the existing project dist folder, click Reload on its extension card instead. Refresh Gmail/Outlook and close/reopen ThreadLens. Export the conversation again; previously downloaded HTML files do not change automatically.\n\nQuoted reply/forward duplicates are reconciled, including copies whose inline pictures the provider re-addressed for each copy, copies whose attribution names the author without recording an address, and the same wording sent twice, where each copy is attached to the message whose gap matches the timezone offset this conversation proved. Differing likely copies remain available under Quoted copy differs. The first visible recipient inclusion is marked when header evidence exists; otherwise ThreadLens labels the first directly available email without claiming a join date. Omitted older history cannot be reconstructed.\n\nA message whose clock the mail page never spells out, such as a collapsed row labelled only 10:32, now keeps the position the mailbox gives it instead of collecting at the end of the timeline. Its date is read from the row header attributes when present, and otherwise placed between the nearest messages with readable clocks and shown as approximate. Opening an email in the mail tab no longer changes the order.\n\nAvailable inline images are shown in place and open full-size on click. Accessible raster images are embedded when exporting; unavailable images are labeled. Text only (no images) exports the same conversation with no image or attachment data, naming each picture instead, such as image-1.png, for a small file to keep or share while testing. Refresh the original mail and export again to replace older placeholder-only exports. Chrome 116 or later is required. Gmail messages are no longer automatically expanded; use Read collapsed emails if needed.\n')
with zipfile.ZipFile(archive) as z: assert z.testzip() is None
(output/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(output.glob('threadlens-*.zip'))))
print(f'Packaged {archive.name}: {archive.stat().st_size:,} bytes; manifest resource paths verified.')
