"""Build the dependency-free Chrome extension bundle with SHA-256 inventory."""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile, ZIP_DEFLATED
import json

root=Path(__file__).resolve().parent
version=json.loads((root/'extension/manifest.json').read_text())['version']
target=root/'outputs'/f'BORSA_TSE_Recorder_v{version}.zip'
target.parent.mkdir(parents=True,exist_ok=True)
excluded={'.git','node_modules','test-results','outputs','__pycache__'}
files=sorted(p for p in root.rglob('*') if p.is_file() and not excluded.intersection(p.relative_to(root).parts) and p.name!='SHA256SUMS.txt' and p.suffix not in {'.xlsx','.zip','.pyc'})
inventory='\n'.join(f'{sha256(p.read_bytes()).hexdigest()}  {p.relative_to(root).as_posix()}' for p in files)+'\n'
(root/'SHA256SUMS.txt').write_text(inventory,encoding='utf-8')
files.append(root/'SHA256SUMS.txt')
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as archive:
    for path in files:
        archive.write(path,root.name+'/'+path.relative_to(root).as_posix())
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert root.name+'/extension/manifest.json' in archive.namelist()
print(f'{target}\n{target.stat().st_size} bytes\n{len(files)} files\nSHA256 {sha256(target.read_bytes()).hexdigest()}')
