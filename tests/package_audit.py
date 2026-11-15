from pathlib import Path
from html.parser import HTMLParser
import json

root=Path(__file__).resolve().parents[1]
ext=root/'extension'
manifest=json.loads((ext/'manifest.json').read_text())
assert manifest['manifest_version']==3
assert manifest['version']=='2.0.0'
assert manifest['minimum_chrome_version']=='120'
assert all('tsetmc.com/' in p for p in manifest['host_permissions'])
paths=[manifest['background']['service_worker']]
for content in manifest['content_scripts']:
    paths.extend(content['js'])
for path in paths:
    assert (ext/path).is_file(),path
class Check(HTMLParser):
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        assert not any(a.lower().startswith('on') for a in attrs), 'Inline event handler'
        if tag=='script':
            assert 'src' in attrs,'Inline JavaScript'
            assert not attrs['src'].startswith(('http:','https:','//')),'Remote executable source'
            assert (ext/attrs['src']).is_file(),attrs['src']
        if tag=='link' and attrs.get('rel')=='stylesheet':
            assert (ext/attrs['href']).is_file()
for path in ext.glob('*.html'):
    Check().feed(path.read_text())
print('Package audit passed: manifest, local dependencies, host scope and CSP-compatible HTML.')
