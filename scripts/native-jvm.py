#!/usr/bin/env python3
"""Optional live JVM compatibility check; tested with Java 21, Python 3 and npm ci.

Downloads SHA-256-pinned compiler/runtime artifacts and Nuvio source snapshots
into ignored .tmp/. No API keys, signed media URLs or media files are persisted.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.tmp/native-jvm'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--bundle', type=Path, default=ROOT / 'providers/anime-sama.js')
    args = parser.parse_args()
    lock = json.loads((ROOT / 'test/native-jvm/dependencies.json').read_text())
    CACHE.mkdir(parents=True, exist_ok=True)

    def dependency(item):
        path = CACHE / item['name']
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            data = urllib.request.urlopen(item['url'], timeout=45).read()
            if hashlib.sha256(data).hexdigest() != item['sha256']:
                raise RuntimeError('Dependency checksum mismatch: ' + item['name'])
            path.write_bytes(data)
        return path

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        files = list(pool.map(dependency, lock['files']))
    jars = [str(path) for path in files if path.suffix == '.jar']
    sources = [str(path) for path in files if path.suffix == '.kt']
    classpath = os.pathsep.join(jars)
    output = CACHE / 'harness.jar'
    subprocess.run(['java', '-cp', classpath, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
                    '-jvm-target', '11', '-no-stdlib', '-no-reflect', '-classpath', classpath,
                    '-d', str(output), str(ROOT / 'test/native-jvm/NativeRuntime.kt'), *sources], check=True)
    transport = subprocess.Popen(['node', 'scripts/native-jvm-transport.js'], cwd=ROOT, stdout=subprocess.PIPE, text=True)
    try:
        port = transport.stdout.readline().strip()
        if not port.isdigit():
            raise RuntimeError('Local HTTP transport failed to start')
        report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'runtime': 'dokar3 quickjs-kt 1.0.15 JVM; exact pinned Nuvio 0.5.9 startup, URL/Ktor and DOM/Ksoup bridges; Node HTTP; not Android playback',
                  'nuvioCommit': lock['nuvioCommit'], 'settings': {}, 'injectedTmdbKey': False,
                  'bundleSha256': hashlib.sha256(args.bundle.read_bytes()).hexdigest(), 'cases': []}
        for title, identity, kind in [('One Piece TMDB', '37854', 'tv'), ('One Piece IMDb', 'tt0388629', 'tv'),
                                       ('One Piece Kitsu', 'kitsu:12', 'series'), ('Jujutsu Kaisen', '95479', 'tv')]:
            run = subprocess.run(['java', '-cp', classpath + os.pathsep + str(output), 'NativeRuntimeKt',
                                  str(args.bundle.resolve()), 'http://127.0.0.1:' + port, identity, kind],
                                 text=True, capture_output=True, timeout=75, check=True)
            if run.stderr:
                print(run.stderr.strip(), flush=True)
            row = {'title': title, **json.loads(run.stdout)}
            print(json.dumps(row, ensure_ascii=False), flush=True)
            report['cases'].append(row)
        if args.output:
            args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        if any(not r['streams'] or (r['mediaSample'] or {}).get('bytes') != 4096 for r in report['cases']):
            raise SystemExit(1)
    finally:
        transport.terminate()
        transport.wait(timeout=10)


if __name__ == '__main__':
    main()
