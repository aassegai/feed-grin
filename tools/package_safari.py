"""Create a Safari-loadable ZIP and a kit for Apple's native app packager."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
manifest = json.loads((source / 'manifest.json').read_text())
assert manifest['manifest_version'] == 3
assert set(manifest['host_permissions']) == set(manifest['content_scripts'][0]['matches'])
resources = []
for item in manifest['content_scripts']:
    resources.extend(item.get('js', []) + item.get('css', []))
for item in manifest.get('web_accessible_resources', []):
    resources.extend(item['resources'])
resources.append(manifest['action']['default_popup'])
for resource in resources:
    if not (source / resource).is_file():
        raise SystemExit(f'Missing resource: {resource}')
output = root / 'dist'
output.mkdir(exist_ok=True)
version = manifest['version']
web_zip = output / f'feed-grin-safari-{version}.zip'
kit_zip = output / f'feed-grin-safari-kit-{version}.zip'
files = sorted(file for file in source.rglob('*') if file.is_file())
with ZipFile(web_zip, 'w', ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, file.relative_to(source).as_posix())
with ZipFile(kit_zip, 'w', ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, 'extension/' + file.relative_to(source).as_posix())
    archive.write(root / 'safari/README.md', 'README.md')
    archive.write(root / 'safari/create-xcode-project.command', 'create-xcode-project.command')
for file in [web_zip, kit_zip]:
    with ZipFile(file) as archive:
        if archive.testzip() is not None:
            raise SystemExit(f'Invalid ZIP: {file}')
    print(f'{file} ({file.stat().st_size:,} bytes)')
