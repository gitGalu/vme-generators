# vme-generators

Builds VM/E import ZIPs with software lists and BIOS/system files. Missing BIOS files are
downloaded automatically; game ROMs are downloaded by VM/E when launched.

```sh
npm install
npm run build-vme-import                       # regenerate lists and build ZIP
npm run build-vme-import -- --only=c64,nes      # refresh selected lists, pack all platforms
npm run build-vme-import -- --pack              # pack existing files (offline)
npm run build-vme-import -- --pack --download-deps  # fetch missing BIOS files and pack
npm run build-vme-import -- --pack --deps-from=backup.zip  # restore missing dependencies and pack
```

Files are stored in `vme_import/`; output is `<timestamp>_vme_import.zip`.
Override with `--src=DIR` and `--out=FILE`.
