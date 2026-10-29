# vme-generators

Generators of import bundles for VM/E.

## build-vme-import.js

Builds a `vme_import.zip` bundle

The bundle holds, for each platform:

- a software list generated from an Internet Archive collection (`CORSFILEv1`: every item's
  URL is `root + bases[baseIndex] + rest`, pointing to a file inside the collection's archive),
- the BIOS/system files the platform needs (`dependencies`).

The generator downloads software **lists** and missing BIOS files. VM/E downloads game
ROMs from the list URLs when you launch them.

BIOS files come from [Abdess/retrobios](https://github.com/Abdess/retrobios), with matching
files from [groenator/retroarch_system](https://github.com/groenator/retroarch_system) as
fallbacks. [bios-sources.json](bios-sources.json) pins the GitHub commits, source paths and
SHA-256 checksums for all 15 required BIOS files. Downloads are verified before being
saved; existing local files are preserved. Atari ST uses TOS 1.02 UK, STE uses TOS 2.06 DE,
and Falcon uses TOS 4.04, matching the original import bundle.

`--pack` remains offline. To fetch missing BIOS files and pack existing lists without
regenerating them:

```
npm run build-vme-import -- --pack --download-deps
```

`DOS/Windows31.dosz` is an optional Windows 3.1 installation, not a BIOS. It is not provided
by these repositories. The generator includes it when supplied locally and otherwise
omits it from the bundle and manifest.

Dependency files can also be restored from an existing import bundle:

```
npm run build-vme-import -- --deps-from=../vme-vibe/private-assets/vme_import.zip
```

`--deps-from=ZIP` copies only missing dependency files at the paths configured in
`PLATFORMS` (including optional dependencies). It preserves existing files and software
lists. Any required BIOS files still missing are downloaded during normal builds.
Unresolved dependencies are reported together before any lists are fetched.

Platforms, collections, filters and dependencies are defined in `PLATFORMS` at the top of
the script.

```
npm install
npm run build-vme-import                      # regenerate all lists, then pack
npm run build-vme-import -- --only=c64,nes    # regenerate only these platforms, then pack
npm run build-vme-import -- --pack            # pack only (no network)
npm run build-vme-import -- --pack --download-deps
                                             # fetch missing BIOS files and pack existing lists
npm run build-vme-import -- --pack --deps-from=../vme-vibe/private-assets/vme_import.zip
                                             # restore dependencies and pack existing lists
```

`--only` limits which lists are regenerated; the resulting ZIP still includes every
configured platform and requires all their non-optional dependency files.

The script works in the current directory:

- `vme_import/` - the BIOS/system files and the generated lists, laid out as in the ZIP
  (`--src=DIR` to change),
- `<timestamp>_vme_import.zip` - the bundle, e.g. `20261028-193005_vme_import.zip`
  (`--out=FILE` to change).

If a collection is no longer available (removed or login-only), the platform keeps its
previous list and the script lists it at the end and exits with code 1.
