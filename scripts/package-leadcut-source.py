"""Archive the full working source tree, excluding Git-ignored build outputs."""
import json
from pathlib import Path
import subprocess
import zipfile

root = Path.cwd()
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
paths = subprocess.check_output(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard']
).decode('utf-8').split('\0')
output = root / 'release' / f'LeadCut-source-{version}.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for relative in sorted(set(paths)):
        if relative and (root / relative).is_file():
            archive.write(root / relative, 'LeadCut/' + relative)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode().strip()
    archive.writestr('LeadCut/SOURCE_INFO.txt',
        f'LeadCut {version}\nUpstream: https://github.com/webadderallorg/Recordly\n'
        f'Base commit: {commit}\nIncludes all local LeadCut modifications.\n'
        'License: AGPLv3 (LICENSE.md). Build: npm ci; npm run build:waveform\n')
print(f'Source archive: {output.name} ({output.stat().st_size} bytes)')
