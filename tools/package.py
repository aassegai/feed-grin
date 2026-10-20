"""Package the unpacked extension and its documentation; no third-party tools."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'extension/manifest.json').read_text())
required = []
for entry in manifest['content_scripts']:
    required.extend(entry.get('css', []) + entry.get('js', []))
for entry in manifest['web_accessible_resources']:
    required.extend(entry['resources'])
required.append(manifest['action']['default_popup'])
for relative in required:
    if not (root / 'extension' / relative).is_file():
        raise SystemExit(f'Missing extension resource: {relative}')
files = list((root / 'extension').rglob('*'))
files += [root / name for name in ('README.md', 'LEGAL.md', 'PRIVACY.md', 'ASSET-NOTICE.md', 'package.json', '.gitignore')]
files += [root / 'tests/smoke.cjs', root / 'tools/package.py']
destination = root / 'dist' / f"feed-grin-{manifest['version']}.zip"
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        if file.is_file():
            archive.write(file, file.relative_to(root).as_posix())
with ZipFile(destination) as archive:
    if archive.testzip() is not None:
        raise SystemExit('Archive validation failed')
print(f'{destination} ({destination.stat().st_size:,} bytes)')
