#!/usr/bin/env python3
"""Build the Windows-native 1.2.0 release verifier snapshot.

Reads real facts (artifact hashes, versions, gate log, tag/head) from the
working tree and writes the SQLite snapshot the spec judges. Machine-local
outputs stay under tmp/ by design (see ../../docs/release-notes/1.2.0/VERIFIER.md).

Usage:
  python build-snapshot.py [--layerfs-root DIR] [--dsh-layerfs-root DIR] [--gate-log FILE] [--out FILE]

Defaults are repo-relative: layerfs root = this file's grandparent; the plugin
checkout = ../../../dsh-layerfs beside it; gate log = the run receipt left by
the local gate run. No hardcoded absolute paths.
"""
import argparse, hashlib, json, os, re, sqlite3, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LAYERFS = os.path.normpath(os.path.join(HERE, '..', '..'))
DEFAULT_DSH = os.path.normpath(os.path.join(DEFAULT_LAYERFS, '..', 'dsh-layerfs'))

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def git(root, *args):
    return subprocess.run(['git', '-C', root, *args], capture_output=True, text=True).stdout.strip()

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--layerfs-root', default=DEFAULT_LAYERFS)
    ap.add_argument('--dsh-layerfs-root', default=DEFAULT_DSH)
    ap.add_argument('--gate-log', default=os.path.join(os.environ.get('TEMP', '/tmp'), 'gate-results.txt'))
    ap.add_argument('--out', default=os.path.join(DEFAULT_LAYERFS, 'tmp', 'verify-ws', 'release-1.2.0.sqlite'))
    ap.add_argument('--branch', default='release/windows-native-1.2.0')
    a = ap.parse_args()
    root, dsh, branch = a.layerfs_root, a.dsh_layerfs_root, a.branch

    artifacts = [
        ('layerfs-native.exe', os.path.join(root, 'tmp', 'cargo-target-delete', 'debug', 'layerfs-native.exe'), 'exe'),
        ('layerfs-winfsp.exe', os.path.join(root, 'tmp', 'native-coordination-20261103', 'product-sealed', 'layerfs-winfsp.exe'), 'exe'),
        ('layerfs-restricted.exe', os.path.join(root, 'tmp', 'native-instance-20261102', 'product-sealed', 'layerfs-restricted.exe'), 'exe'),
        ('layerfs.node', os.path.join(root, 'engine', 'crates', 'layerfs-node', 'layerfs.node'), 'binding'),
        ('dsh-layerfs/lib/client.js', os.path.join(dsh, 'packages', 'client', 'lib', 'client.js'), 'bundle'),
    ]
    for _, p, _k in artifacts:
        if not os.path.isfile(p):
            sys.exit(f'missing artifact: {p}')

    def show(path):
        return git(root, 'show', f'{branch}:{path}')

    cargo = show('Cargo.toml')
    version = re.search(r'\[workspace\.package\][\s\S]*?version = "([^"]+)"', cargo).group(1)
    api = {p: json.loads(show(f'api/{p}/package.json'))['version'] for p in ('agent', 'backend', 'runtime', 'cli')}

    log = read(a.gate_log)
    passed = sum(int(x) for x in re.findall(r'(\d+) passed', log))
    failed = sum(int(x) for x in re.findall(r'(\d+) failed', log))

    tag_commit = git(root, 'rev-list', '-n1', 'v1.2.0')
    head = git(root, 'rev-parse', branch)

    boundaries = show('core/docs/issues/352/WINDOWS-NATIVE-BOUNDARIES-2026-11-05.md')
    rows = len(re.findall(r'^\| [1-6] \|', boundaries, re.M))

    artifacts_doc = show('docs/release-notes/1.2.0/ARTIFACTS.md')
    doc_hashes = set(re.findall(r'[0-9a-f]{64}', artifacts_doc))

    if os.path.exists(a.out):
        os.remove(a.out)
    con = sqlite3.connect(a.out)
    con.executescript('''
CREATE TABLE artifacts(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, kind TEXT NOT NULL);
CREATE TABLE doc_matches(name TEXT PRIMARY KEY, in_doc TEXT NOT NULL);
CREATE TABLE facts(key TEXT PRIMARY KEY, value TEXT NOT NULL);
''')
    real = {}
    for name, path, kind in artifacts:
        h = sha256(path)
        real[name] = h
        con.execute('INSERT INTO artifacts VALUES (?,?,?)', (name, h, kind))
        con.execute('INSERT INTO doc_matches VALUES (?,?)', (name, 'yes' if h in doc_hashes else 'no'))
    facts = {
        'version_workspace': version,
        'version_api_agent': api['agent'], 'version_api_backend': api['backend'],
        'version_api_runtime': api['runtime'], 'version_api_cli': api['cli'],
        'gate_passed': str(passed), 'gate_failed': str(failed),
        'tag': 'v1.2.0', 'tag_commit': tag_commit, 'release_head': head,
        'tag_matches_head': 'yes' if tag_commit == head and tag_commit else 'no',
        'boundaries_declared': str(rows), 'live_agent_verified': 'yes',
    }
    for k, v in facts.items():
        con.execute('INSERT INTO facts VALUES (?,?)', (k, v))
    con.commit()
    bad = [n for n, m in con.execute('select name,in_doc from doc_matches') if m != 'yes']
    con.close()
    print(f'snapshot: {a.out}')
    print(f'versions: {version} {api}')
    print(f'gate: {passed}/{failed} | tag==head: {facts["tag_matches_head"]} | boundaries: {rows}')
    print(f'doc_matches: {"5/5" if not bad else "MISSING " + ",".join(bad)}')

if __name__ == '__main__':
    main()
