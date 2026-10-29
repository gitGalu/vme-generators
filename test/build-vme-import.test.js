const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const { PLATFORMS, downloadDependency, prepareDependencies, pack } = require('../build-vme-import');
const sources = require('../bios-sources.json');

function directory(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vme-import-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function write(dir, file, data) {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
}

function fixture(t) {
    const dir = directory(t);
    for (const entry of PLATFORMS) {
        write(dir, entry.file, JSON.stringify({ version: 'CORSFILEv1', items: [] }));
        for (const file of Object.values(entry.dependencies || {})) write(dir, file, 'existing BIOS');
    }
    return dir;
}

test('every required BIOS has a checksum and pinned sources', () => {
    const required = PLATFORMS.flatMap(entry => Object.values(entry.dependencies || {}));
    assert.equal(required.length, 15);
    assert.deepEqual(Object.keys(sources.files).sort(), required.sort());
    for (const source of Object.values(sources.files)) {
        assert.match(source.sha256, /^[a-f0-9]{64}$/);
        assert.ok(source.sources.length > 0);
        for (const [repository] of source.sources) assert.match(sources.repositories[repository], /^[a-f0-9]{40}$/);
    }
});

test('downloads binary data from a pinned fallback after a 404', async t => {
    const data = Buffer.from([0, 255, 128, 13, 10]);
    const calls = [];
    t.mock.method(global, 'fetch', async url => {
        calls.push(url);
        return calls.length === 1 ? new Response('', { status: 404 }) : new Response(data);
    });
    const result = await downloadDependency('fixture.bin', {
        sha256: createHash('sha256').update(data).digest('hex'),
        sources: [['Abdess/retrobios', 'path with spaces/fixture.bin'], ['groenator/retroarch_system', 'fixture.bin']]
    });
    assert.deepEqual(result, data);
    assert.equal(calls.length, 2);
    assert.equal(calls[0], `https://raw.githubusercontent.com/Abdess/retrobios/${sources.repositories['Abdess/retrobios']}/path%20with%20spaces/fixture.bin`);
});

test('corrupt downloads are rejected without writing a dependency', async t => {
    const src = fixture(t);
    const file = 'A800/ATARIXL.ROM';
    fs.unlinkSync(path.join(src, file));
    const calls = [];
    t.mock.method(global, 'fetch', async url => {
        calls.push(url);
        return new Response('not a BIOS');
    });
    await assert.rejects(prepareDependencies({ src, pack: true, downloadDeps: true }), /SHA-256 mismatch/);
    assert.equal(calls.length, sources.files[file].sources.length);
    assert.equal(fs.existsSync(path.join(src, file)), false);
});

test('offline packing reports all missing BIOS files without fetching', async t => {
    const src = directory(t);
    const fetch = t.mock.method(global, 'fetch', () => { throw new Error('Unexpected network access'); });
    await assert.rejects(prepareDependencies({ src, pack: true }), error => {
        assert.match(error.message, /Missing BIOS\/system files \(15\)/);
        for (const file of Object.keys(sources.files)) assert.ok(error.message.includes(file));
        return true;
    });
    assert.equal(fetch.mock.callCount(), 0);
});

test('existing BIOS files are preserved and Windows 3.1 is optional', async t => {
    const src = fixture(t);
    const fetch = t.mock.method(global, 'fetch', () => { throw new Error('Unexpected network access'); });
    await prepareDependencies({ src, pack: false });
    const out = path.join(src, 'bundle.zip');
    await pack({ src, out });
    let zip = await JSZip.loadAsync(fs.readFileSync(out));
    let manifest = JSON.parse(await zip.file('vme_import.json').async('string'));
    assert.equal(manifest.platforms.dos.dependencies, undefined);
    assert.equal(zip.file('DOS/Windows31.dosz'), null);

    const old = new JSZip();
    old.file('A800/ATARIXL.ROM', 'different BIOS');
    old.file('DOS/Windows31.dosz', 'local Windows installation');
    const depsFrom = path.join(src, 'old.zip');
    fs.writeFileSync(depsFrom, await old.generateAsync({ type: 'nodebuffer' }));
    await prepareDependencies({ src, pack: true, depsFrom });
    assert.equal(fs.readFileSync(path.join(src, 'A800/ATARIXL.ROM'), 'utf8'), 'existing BIOS');
    await pack({ src, out });
    zip = await JSZip.loadAsync(fs.readFileSync(out));
    manifest = JSON.parse(await zip.file('vme_import.json').async('string'));
    assert.equal(manifest.platforms.dos.dependencies['win31.dosz'], 'DOS/Windows31.dosz');
    assert.equal(await zip.file('DOS/Windows31.dosz').async('string'), 'local Windows installation');
    assert.equal(fetch.mock.callCount(), 0);
});
