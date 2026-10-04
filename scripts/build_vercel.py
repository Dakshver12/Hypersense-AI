"""Bundle Debian GL dispatch libraries without requiring apt or root privileges."""
import gzip
import hashlib
import io
import platform
import tarfile
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://deb.debian.org/debian/'
PACKAGES = {'libglvnd0':'libGLdispatch.so.0', 'libegl1':'libEGL.so.1', 'libgles2':'libGLESv2.so.2'}


def fetch(url):
    with urlopen(url, timeout=60) as response:
        return response.read()


def data_archive(deb):
    if not deb.startswith(b'!<arch>\n'):
        raise RuntimeError('Invalid Debian package archive')
    offset = 8
    while offset + 60 <= len(deb):
        header = deb[offset:offset+60]
        name = header[:16].decode().strip().rstrip('/')
        size = int(header[48:58].decode().strip())
        payload = deb[offset+60:offset+60+size]
        if name.startswith('data.tar'):
            return payload
        offset += 60 + size + size % 2
    raise RuntimeError('Missing Debian package data')


def main():
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64','AMD64'):
        raise RuntimeError('This Vercel native build expects Linux x86_64')
    index = gzip.decompress(fetch(BASE+'dists/bookworm/main/binary-amd64/Packages.gz')).decode()
    found = {}
    for block in index.split('\n\n'):
        fields = dict(line.split(': ',1) for line in block.splitlines() if ': ' in line and not line.startswith(' '))
        if fields.get('Package') in PACKAGES:
            found[fields['Package']] = fields
    target = ROOT / '.vercel-native'
    target.mkdir(exist_ok=True)
    for package, soname in PACKAGES.items():
        fields = found[package]
        payload = fetch(BASE+fields['Filename'])
        if hashlib.sha256(payload).hexdigest() != fields['SHA256']:
            raise RuntimeError('Debian package checksum mismatch')
        with tarfile.open(fileobj=io.BytesIO(data_archive(payload)), mode='r:*') as archive:
            matches = [member for member in archive.getmembers() if member.isfile()
                       and Path(member.name).name.startswith(soname)]
            if len(matches) != 1:
                raise RuntimeError('Unexpected native library contents')
            (target/soname).write_bytes(archive.extractfile(matches[0]).read())
            copyright_path = './usr/share/doc/'+package+'/copyright'
            try:
                (target/(package+'-copyright.txt')).write_bytes(archive.extractfile(copyright_path).read())
            except KeyError:
                raise RuntimeError('Missing library license notice') from None
        print('Bundled',soname)


if __name__ == '__main__':
    main()
