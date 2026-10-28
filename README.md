# vme-generators

Generators of import bundles for VM/E.

## build-vme-import.js

Builds a `vme_import.zip` bundle

The bundle holds, for each platform:

- a software list generated from an Internet Archive collection (`CORSFILEv1`: every item's
  URL is `root + bases[baseIndex] + rest`, pointing to a file inside the collection's archive),
- the BIOS/system files the platform needs (`dependencies`).

Platforms, collections, filters and dependencies are defined in `PLATFORMS` at the top of
the script.

```
npm install
npm run build-vme-import                      # regenerate all lists, then pack
npm run build-vme-import -- --only=c64,nes    # regenerate only these platforms, then pack
npm run build-vme-import -- --pack            # pack only (no network)
```

The script works in the current directory:

- `vme_import/` - the BIOS/system files and the generated lists, laid out as in the ZIP
  (`--src=DIR` to change),
- `<timestamp>_vme_import.zip` - the bundle, e.g. `20261028-193005_vme_import.zip`
  (`--out=FILE` to change).

If a collection is no longer available (removed or login-only), the platform keeps its
previous list and the script lists it at the end and exits with code 1.
