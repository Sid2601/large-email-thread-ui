"""Package an already-built local extension; run through npm run release."""
from pathlib import Path
import json, zipfile, hashlib, shutil
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
 z.writestr('INSTALL.txt',f'ThreadLens {version}\n\nExtract this ZIP. Open chrome://extensions, enable Developer mode, click Load unpacked, and select the extracted folder containing manifest.json. If using the existing project dist folder, click Reload on its extension card instead. Refresh Gmail/Outlook and close/reopen ThreadLens. Export the conversation again; previously downloaded HTML files do not change automatically.\n\nOpening an already represented email now ignores generated image-caption differences and removes redundant clipped/formatting-only quoted variants. Fuller text and available pictures are retained, while actual wording/signature/image changes remain inspectable.\n\nQuoted reply/forward duplicates are reconciled, including copies whose inline pictures the provider re-addressed for each copy, copies whose attribution names the author without recording an address, and the same wording sent twice, where each copy is attached to the message whose gap matches the timezone offset this conversation proved. Differing likely copies remain available under Quoted copy differs. The first visible recipient inclusion is marked when header evidence exists; otherwise ThreadLens labels the first directly available email without claiming a join date. Omitted older history cannot be reconstructed.\n\nMessages now follow the order in which the emails actually reply to each other, taken from the way each reply encloses the one before it, instead of from quoted clocks alone. A quoted reply header is written by the replying client in its own timezone and records no offset, so correspondents in different countries could previously read out of order — a 09:04 reply appearing above the 13:28 message it answered. Where the reply chain overrules the clocks, both messages are marked Placed by the quoted reply chain in the panel and the export. Threads written in one timezone, and messages no reply chain relates, are ordered exactly as before. The times themselves are unchanged and still read from quoted text where no provider header supplies them.\n\nA message whose clock the mail page never spells out, such as a collapsed row labelled only 10:32, now keeps the position the mailbox gives it instead of collecting at the end of the timeline. Its date is read from the row header attributes when present, and otherwise placed between the nearest messages with readable clocks and shown as approximate. Opening an email in the mail tab no longer changes the order.\n\nAvailable inline images are shown in place and open full-size on click. Accessible raster images are embedded when exporting; unavailable images are labeled. Text only (no images) exports the same conversation with no image or attachment data, naming each picture instead, such as image-1.png, for a small file to keep or share while testing. Refresh the original mail and export again to replace older placeholder-only exports. Chrome 116 or later is required. Gmail messages are no longer automatically expanded; use Read collapsed emails if needed.\n')
with zipfile.ZipFile(archive) as z: assert z.testzip() is None
# An unpacked copy as well, so Load unpacked needs no manual extraction step.
folder=output/f'threadlens-{version}'
if folder.exists(): shutil.rmtree(folder)
with zipfile.ZipFile(archive) as z: z.extractall(folder)
assert (folder/'manifest.json').is_file()
(output/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(output.glob('threadlens-*.zip'))))
print(f'Packaged {archive.name}: {archive.stat().st_size:,} bytes; manifest resource paths verified.')
print(f'::zip {archive}')
print(f'::folder {folder}')
print(f'::sha256 {hashlib.sha256(archive.read_bytes()).hexdigest()}')
