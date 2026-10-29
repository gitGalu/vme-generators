#!/usr/bin/env node

// Builds vme_import.zip: the software lists of every platform, generated from Internet Archive
// collections, plus the BIOS/system files they need.
//
// Usage:
//   node build-vme-import.js                 regenerate all lists, then pack
//   node build-vme-import.js --only=c64,nes  regenerate only these platforms, then pack
//   node build-vme-import.js --pack          pack only (no network)
//
// Options:
//   --src=DIR   bundle source directory (default: vme_import). Holds the dependency files and
//               the generated lists, laid out as in the ZIP.
//   --out=FILE  output ZIP (default: <timestamp>_vme_import.zip)
//   --deps-from=ZIP  restore missing BIOS/system files from an existing import bundle
//   --download-deps  download missing BIOS files even with --pack (normally offline)
//
// A software list (CORSFILEv1) is { version, name, root, bases, items }, where every item is
// [displayName, baseIndex, rest] and its URL is root + bases[baseIndex] + rest. archive.org
// serves single files from inside a ZIP/7z/RAR, so a list can point into one big archive.

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const JSZip = require('jszip');
const BIOS_SOURCES = require('./bios-sources.json');

const ARCHIVE = 'https://archive.org';

// source kinds:
//   { id, archive }   one archive in the collection; every file inside becomes an item
//                     (include / exclude: keep only / drop files whose directory contains one
//                      of the strings; excludeExt: drop files with these extensions)
//   { id, perArchive: true }
//                     a collection of single-game archives; each archive's only file is an item
//   { id, files: ['.zip'] }
//                     the collection's own files with these extensions are the items (served
//                     through archive.org/cors/)
//   sources: [...]    several sources merged into one list (optional tag per source - shown
//                     as a label in the results; tagPriority orders tagged results)
const PLATFORMS = [
    { platform: 'atari2600', file: 'A2600/A2600.json',
      source: { id: 'cylums-atari-2600-rom-collection', archive: "Cylum's Atari 2600 ROM Collection (02-16-2021).zip" } },
    { platform: 'atari800', file: 'A800/Atari8bit-201808.json',
      source: { id: 'Atari8bit-201808', archive: 'ROMS.zip' },
      dependencies: {
          'ATARIXL.ROM': 'A800/ATARIXL.ROM',
          'ATARIBAS.ROM': 'A800/ATARIBAS.ROM',
          'ATARIOSA.ROM': 'A800/ATARIOSA.ROM',
          'ATARIOSB.ROM': 'A800/ATARIOSB.ROM'
      } },
    { platform: 'atari5200', file: 'A5200/A5200.json',
      source: { id: 'atari-5200-rom-collection', archive: 'Atari 5200 ROM Collection.zip' },
      dependencies: { '5200.rom': 'A5200/5200.rom' } },
    { platform: 'a7800', file: 'A7800/nointro.atari-7800.json',
      source: { id: 'nointro.atari-7800', perArchive: true } },
    { platform: 'amiga', file: 'Amiga/combined-amiga.json',
      name: 'Games WHDLoad + Commodore Amiga [TOSEC v2012-04-10]',
      sources: [
          { id: 'GamesWHDLoad', archive: 'Games-WHDLoad.rar', tag: 'WHDLoad' },
          { id: 'Commodore_Amiga_TOSEC_2012_04_10', archive: 'Commodore_Amiga_TOSEC_2012_04_10.zip' }
      ],
      dependencies: {
          'kick34005.A500': 'Amiga/kick34005.A500',
          'kick40063.A600': 'Amiga/kick40063.A600',
          'kick40068.A1200': 'Amiga/kick40068.A1200'
      } },
    { platform: 'apple2', file: 'Apple2/Apple2.json',
      source: { id: 'Apple_2_TOSEC_2012_04_23', archive: 'Apple_2_TOSEC_2012_04_23.zip' } },
    { platform: 'c64', file: 'C64/C64.json',
      source: { id: 'Commodore_C64_TOSEC_2012_04_23', archive: 'Commodore_C64_TOSEC_2012_04_23.zip' } },
    { platform: 'c128', file: 'C128/C128.json',
      source: { id: 'tosec-20161111-commodore-c128', archive: 'TOSEC.2016.11.11.Commodore.C128.AlphaBot.zip' } },
    { platform: 'c264', file: 'C264/Commodore_C16_C116_Plus_4_TOSEC_2012_04_23.json',
      source: { id: 'Commodore_C16_C116_Plus_4_TOSEC_2012_04_23', archive: 'Commodore_C16_C116_Plus_4_TOSEC_2012_04_23.zip' } },
    { platform: 'gb', file: 'GB/GB.json',
      source: { id: 'GameboyROMS_201810', archive: 'Gameboy_ROMS.zip' } },
    { platform: 'gbc', file: 'GBC/GBC.json',
      source: { id: 'gbc_20230205', archive: 'gbc.zip', excludeExt: ['.png', '.xml'] } },
    { platform: 'nes', file: 'NES/NES.json',
      source: { id: 'nintendo-entertainment-system-all-nes-roms-goodnes', archive: 'All NES Roms (GoodNES).zip' } },
    { platform: 'snes', file: 'SNES/SNES.json',
      source: { id: 'ef_nintendo_snes_no-intro_2024-04-20', files: ['.zip'] } },
    { platform: 'sms', file: 'SMS/SMS.json',
      source: { id: 'no-intro-sega-master-system-mark-iii-20170414', archive: 'No-Intro - Sega - Master System - Mark III (2017-04-14).zip' } },
    { platform: 'coleco', file: 'Coleco/Coleco_ColecoVision_TOSEC_2012_04_23.json',
      source: { id: 'Coleco_ColecoVision_TOSEC_2012_04_23', archive: 'Coleco_ColecoVision_TOSEC_2012_04_23.zip' },
      dependencies: { 'colecovision.rom': 'Coleco/colecovision.rom' } },
    { platform: 'cpc', file: 'CPC/Amstrad_CPC_TOSEC_2012_04_23.json',
      source: { id: 'Amstrad_CPC_TOSEC_2012_04_23', archive: 'Amstrad_CPC_TOSEC_2012_04_23.zip' } },
    { platform: 'st', file: 'ST/Atari_ST_TOSEC_2012_04_23.json',
      source: { id: 'Atari_ST_TOSEC_2012_04_23', archive: 'Atari_ST_TOSEC_2012_04_23.zip' },
      dependencies: { 'tos.img': 'ST/tos.img', 'ste.img': 'ST/ste.img', 'falcon.img': 'ST/falcon.img' } },
    { platform: 'msx', file: 'MSX/MSX_MSX_TOSEC_2012_04_23.json',
      source: { id: 'MSX_MSX_TOSEC_2012_04_23', archive: 'MSX_MSX_TOSEC_2012_04_23.zip' } },
    { platform: 'lynx', file: 'Lynx/lynx.json',
      source: { id: 'AtariLynx_201808', archive: 'ROMS.zip' } },
    { platform: 'jaguar', file: 'Jaguar/Jaguar.json',
      source: { id: 'atarijaguarroms_201909', archive: 'Atari_Jaguar_ROMS.zip' } },
    { platform: 'vic20', file: 'VIC20/vic20.json',
      source: { id: 'Commodore_VIC20_TOSEC_2012_04_23', archive: 'Commodore_VIC20_TOSEC_2012_04_23.zip' } },
    { platform: 'zx80', file: 'ZX80/Sinclair_ZX81_TOSEC_2012_04_23.json',
      source: { id: 'Sinclair_ZX81_TOSEC_2012_04_23', archive: 'Sinclair_ZX81_TOSEC_2012_04_23.zip' } },
    { platform: 'spectrum', file: 'Spectrum/Sinclair_ZX_Spectrum_TOSEC_2012_04_23.json',
      source: { id: 'Sinclair_ZX_Spectrum_TOSEC_2012_04_23', archive: 'Sinclair_ZX_Spectrum_TOSEC_2012_04_23.zip' } },
    { platform: 'pce', file: 'PCE/PCE.json',
      source: { id: 'cylums-turbo-grafx-16-rom-collection', archive: "Cylum's TurboGrafx-16 ROM Collection (02-14-2021).zip" } },
    { platform: 'smd', file: 'SMD/SMD.json',
      source: { id: 'sega-mega-drive-europe', perArchive: true } },
    { platform: 'snk', file: 'SNK/SNK.json',
      source: { id: 'neo-geo-aes-romset', files: ['.zip'] } },
    { platform: 'gba', file: 'GBA/GameBoyAdvanceTOSEC.json',
      source: { id: 'GameBoyAdvanceTOSEC', perArchive: true },
      dependencies: { 'gba_bios.bin': 'GBA/gba_bios.bin' } },
    { platform: 'intv', file: 'Intellivision/Mattel_Intellivision_TOSEC_2012_04_23.json',
      source: { id: 'Mattel_Intellivision_TOSEC_2012_04_23', archive: 'Mattel_Intellivision_TOSEC_2012_04_23.zip' },
      dependencies: { 'exec.bin': 'Intellivision/exec.bin', 'grom.bin': 'Intellivision/grom.bin' } },
    { platform: 'mame', file: 'MAME/MAME2003.json',
      source: { id: 'ForoRaspberry.es_Romset0.78LrMame2003_201805', archive: 'Romset_0.78_lr-mame2003.zip' } },
    { platform: 'xt', file: 'XT/XT.json',
      source: { id: '525-dos-games-80s', archive: '525DosGamesFromThe80sProper.zip' } },
    { platform: 'pico-8', file: 'PICO-8/PICO-8.json',
      source: { id: 'pico-8-all-versions-collection', archive: 'Pico 8 (All Versions & Collection).zip' } },
    { platform: 'dos', file: 'DOS/DOS.json',
      sources: [
          { id: 'dos-games-collection-zip-file', archive: 'dos.zip' },
          { id: '630-windows-3x-games', archive: '630Windows3.0Games.zip', tag: 'WIN' }
      ],
      tagPriority: { WIN: 1 },
      optionalDependencies: { 'win31.dosz': 'DOS/Windows31.dosz' } },
    { platform: 'tic80', file: 'TIC-80/TIC-80.json',
      source: { id: 'tic-80-cartridges-17-07-2025', archive: 'tic80_cartridges 17-07-2025.zip' } },
];

const CONCURRENCY = 6;
const RETRIES = 5; // archive.org answers 403/429/5xx when it throttles

// e.g. 20261028-193005
function timestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function parseArgs(argv) {
    const args = {
        pack: false,
        only: null,
        depsFrom: null,
        downloadDeps: false,
        src: 'vme_import',
        out: `${timestamp()}_vme_import.zip`
    };
    for (const arg of argv) {
        const [key, value] = arg.replace(/^--/, '').split('=');
        if (key === 'pack') args.pack = true;
        else if (key === 'only') args.only = new Set(value.split(','));
        else if (key === 'src') args.src = value;
        else if (key === 'out') args.out = value;
        else if (key === 'deps-from' && value) args.depsFrom = value;
        else if (key === 'download-deps') args.downloadDeps = true;
        else throw new Error(`Unknown option: ${arg}`);
    }
    return args;
}

async function fetchWithRetries(url, readResponse) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return await readResponse(response);
        } catch (error) {
            if (error.status === 404 || attempt >= RETRIES) throw new Error(`${url}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
        }
    }
}

async function fetchText(url) {
    return fetchWithRetries(url, response => response.text());
}

async function fetchMetadata(id) {
    const metadata = JSON.parse(await fetchText(`${ARCHIVE}/metadata/${encodeURIComponent(id)}`));
    if (metadata.is_dark || !metadata.files) throw new Error(`Collection ${id} is no longer available`);
    if (metadata.metadata?.['access-restricted-item'] === 'true') {
        throw new Error(`Collection ${id} is restricted (login required) - its files cannot be downloaded`);
    }
    return metadata;
}

function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function encodePathPart(part) {
    return encodeURIComponent(part).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function archiveUrl(id, archive) {
    return `${ARCHIVE}/download/${encodePathPart(id)}/${archive.split('/').map(encodePathPart).join('/')}/`;
}

// Files inside an archive, from archive.org's archive viewer: [{ href, text }], where href is
// '//archive.org/download/<id>/<archive>/<inner path with %2F>' and text the inner path.
async function listArchive(id, archive) {
    const html = await fetchText(archiveUrl(id, archive));
    const table = /<table class="archext">([\s\S]*?)<\/table>/.exec(html);
    if (!table) throw new Error(`No archive listing for ${id}/${archive}`);
    const entries = [];
    for (const match of table[1].matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)) {
        entries.push({ href: decodeEntities(match[1]), text: decodeEntities(match[2]) });
    }
    return entries;
}

function extensionOf(name) {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

async function buildFromArchive(source) {
    const entries = await listArchive(source.id, source.archive);
    if (entries.length === 0) throw new Error(`Empty archive ${source.id}/${source.archive}`);

    // The archive path ends at the last literal '/'; inner directories are encoded as %2F.
    const prefix = entries[0].href.slice(0, entries[0].href.lastIndexOf('/') + 1);
    const excludeExt = (source.excludeExt || []).map(ext => ext.toLowerCase());
    const bases = [];
    const items = [];
    for (const { href, text } of entries) {
        if (!href.startsWith(prefix)) throw new Error(`Unexpected entry ${href}`);
        const inner = href.slice(prefix.length);
        const split = inner.lastIndexOf('%2F') + 3; // 2 when there is no directory
        const base = split > 2 ? inner.slice(0, split) : '';
        const rest = split > 2 ? inner.slice(split) : inner;
        const directory = decodeURIComponent(base);
        if (source.include && !source.include.some(part => directory.includes(part))) continue;
        if (source.exclude && source.exclude.some(part => directory.includes(part))) continue;
        const displayName = text.split('/').pop();
        if (excludeExt.includes(extensionOf(displayName))) continue;

        let baseIndex = bases.indexOf(base);
        if (baseIndex < 0) baseIndex = bases.push(base) - 1;
        items.push([displayName, baseIndex, rest]);
    }
    return { root: `https:${prefix}`, bases, items };
}

async function mapLimited(values, limit, fn) {
    const results = new Array(values.length);
    let next = 0;
    const worker = async () => {
        while (next < values.length) {
            const index = next++;
            results[index] = await fn(values[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
    return results;
}

async function buildPerArchive(source, metadata) {
    const archives = metadata.files
        .filter(file => /\.(zip|7z|rar)$/i.test(file.name) && file.source === 'original')
        .map(file => file.name)
        .sort((a, b) => a.localeCompare(b));
    const root = `${ARCHIVE}/download/${encodeURIComponent(source.id)}/`;
    let done = 0;
    const lists = await mapLimited(archives, CONCURRENCY, async archive => {
        const entries = await listArchive(source.id, archive);
        done++;
        if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${archives.length}`);
        if (entries.length !== 1) {
            console.warn(`\n  skipped ${archive}: ${entries.length} files inside`);
            return null;
        }
        const { href, text } = entries[0];
        return [text.split('/').pop(), 0, href.slice(`//archive.org/download/${encodeURIComponent(source.id)}/`.length)];
    });
    if (process.stdout.isTTY) process.stdout.write('\n');
    return { root, bases: [''], items: lists.filter(Boolean) };
}

function buildFromFiles(source, metadata) {
    const extensions = source.files.map(ext => ext.toLowerCase());
    const names = metadata.files
        .filter(file => file.source === 'original' && extensions.includes(extensionOf(file.name)))
        .map(file => file.name)
        .sort((a, b) => a.localeCompare(b));
    const items = names.map(name => [name.split('/').pop(), 0, name.split('/').map(encodePathPart).join('/')]);
    // A plain /download/ URL redirects without CORS headers (the browser blocks it); /cors/ serves
    // the same file with them. Files inside archives (the other kinds) are fine via /download/.
    return { root: `${ARCHIVE}/cors/${encodePathPart(source.id)}/`, bases: [''], items };
}

async function buildSource(source) {
    const metadata = await fetchMetadata(source.id);
    const list = source.files ? buildFromFiles(source, metadata)
        : source.perArchive ? await buildPerArchive(source, metadata)
        : await buildFromArchive(source);
    return { title: metadata.metadata?.title || source.id, ...list };
}

async function buildList(entry) {
    if (entry.source) {
        const { title, root, bases, items } = await buildSource(entry.source);
        return { version: 'CORSFILEv1', name: entry.name || title, root, bases, items };
    }

    // Merged list: bases become absolute URLs and the root is empty.
    const list = { version: 'CORSFILEv1', name: entry.name, root: '', bases: [], items: [], tags: {} };
    for (const source of entry.sources) {
        console.log(`  ${source.id}`);
        const part = await buildSource(source);
        const offset = list.bases.length;
        part.bases.forEach((base, index) => {
            list.bases.push(part.root + base);
            if (source.tag) list.tags[offset + index] = source.tag;
        });
        for (const [displayName, baseIndex, rest] of part.items) list.items.push([displayName, offset + baseIndex, rest]);
    }
    if (entry.tagPriority) list.tagPriority = entry.tagPriority;
    return list;
}

async function downloadDependency(file, specification = BIOS_SOURCES.files[file]) {
    if (!specification) throw new Error(`No download source configured for ${file}`);
    const errors = [];
    for (const [repository, sourcePath] of specification.sources) {
        const revision = BIOS_SOURCES.repositories[repository];
        const url = `https://raw.githubusercontent.com/${repository}/${revision}/`
            + sourcePath.split('/').map(encodePathPart).join('/');
        try {
            const data = await fetchWithRetries(url, async response => Buffer.from(await response.arrayBuffer()));
            const hash = createHash('sha256').update(data).digest('hex');
            if (hash !== specification.sha256) throw new Error(`SHA-256 mismatch for ${file}`);
            return data;
        } catch (error) {
            errors.push(`${repository}: ${error.message}`);
        }
    }
    throw new Error(errors.join('\n    '));
}

async function prepareDependencies(args) {
    const required = [...new Set(PLATFORMS.flatMap(entry => Object.values(entry.dependencies || {})))];
    const files = [...new Set(PLATFORMS.flatMap(entry => Object.values({
        ...entry.dependencies, ...entry.optionalDependencies
    })))];
    if (args.depsFrom) {
        const zip = await JSZip.loadAsync(fs.readFileSync(args.depsFrom));
        for (const file of files) {
            const filePath = path.join(args.src, file);
            if (fs.existsSync(filePath)) continue;
            const source = zip.file(file);
            if (!source) continue;
            const data = await source.async('nodebuffer');
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, data, { flag: 'wx' });
            console.log(`Restored ${file} from ${args.depsFrom}`);
        }
    }

    const errors = [];
    if (!args.pack || args.downloadDeps) {
        for (const file of required) {
            const filePath = path.join(args.src, file);
            if (fs.existsSync(filePath)) continue;
            try {
                console.log(`Downloading BIOS ${file}`);
                const data = await downloadDependency(file);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, data, { flag: 'wx' });
            } catch (error) {
                errors.push(`  ${file}: ${error.message}`);
            }
        }
    }

    const missing = required.filter(file => !fs.existsSync(path.join(args.src, file)));
    if (missing.length > 0) {
        throw new Error(`Missing BIOS/system files (${missing.length}):\n`
            + missing.map(file => `  ${path.join(args.src, file)}`).join('\n')
            + (errors.length ? `\nDownload errors:\n${errors.join('\n')}` : '')
            + '\nUse --download-deps to fetch missing BIOS files, supply them in the source directory,'
            + ' or use --deps-from=EXISTING_vme_import.zip.');
    }
}

async function pack(args) {
    const zip = new JSZip();
    const manifest = { platforms: {} };
    for (const entry of PLATFORMS) {
        const platform = { software: entry.file };
        const dependencies = { ...entry.dependencies };
        for (const [key, file] of Object.entries(entry.optionalDependencies || {})) {
            if (fs.existsSync(path.join(args.src, file))) dependencies[key] = file;
            else console.log(`Skipping optional ${file} (not supplied locally)`);
        }
        if (Object.keys(dependencies).length) platform.dependencies = dependencies;
        manifest.platforms[entry.platform] = platform;

        for (const file of [entry.file, ...Object.values(dependencies)]) {
            const filePath = path.join(args.src, file);
            if (!fs.existsSync(filePath)) throw new Error(`Missing ${filePath}`);
            zip.file(file, fs.readFileSync(filePath));
        }
    }
    zip.file('vme_import.json', JSON.stringify(manifest, null, 2));

    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    fs.writeFileSync(args.out, data);
    console.log(`Wrote ${args.out} (${(data.length / 1024 / 1024).toFixed(1)} MB, ${PLATFORMS.length} platforms)`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.only) {
        const unknown = [...args.only].filter(id => !PLATFORMS.some(entry => entry.platform === id));
        if (unknown.length > 0) throw new Error(`Unknown platform(s): ${unknown.join(', ')}`);
    }

    // Packing always includes every platform, even when only some lists are regenerated.
    // Check dependencies before spending time fetching any software lists.
    await prepareDependencies(args);

    // A platform that fails (collection removed, network error) keeps its previous list.
    const failed = [];
    if (!args.pack) {
        for (const entry of PLATFORMS) {
            if (args.only && !args.only.has(entry.platform)) continue;
            console.log(`${entry.platform}: ${entry.file}`);
            try {
                const list = await buildList(entry);
                const filePath = path.join(args.src, entry.file);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, JSON.stringify(list));
                console.log(`  ${list.items.length} items, ${list.bases.length} directories`);
            } catch (error) {
                console.error(`  FAILED: ${error.message}`);
                failed.push(entry.platform);
            }
        }
    }

    await pack(args);
    if (failed.length > 0) {
        console.error(`Previous lists kept for: ${failed.join(', ')}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message || error);
        process.exit(1);
    });
}

module.exports = { PLATFORMS, parseArgs, downloadDependency, prepareDependencies, pack };
