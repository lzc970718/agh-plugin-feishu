import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url)),
  require = createRequire(import.meta.url)
const { build } = require('esbuild')
await mkdir(join(here, 'dist'), { recursive: true })
const icon = await readFile(join(here, 'assets/feishu.png'))
if (icon.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG icon')
const manifest = JSON.parse(await readFile(join(here, 'src/channel.json'), 'utf8'))
manifest.icon = 'data:image/png;base64,' + icon.toString('base64')
if (manifest.icon.length > 32768) throw new Error('Channel icon exceeds manifest budget')
const result = await build({
  plugins: [{ name: 'channel-icon', setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/]channel\.json$/ }, () => ({ contents: JSON.stringify(manifest), loader: 'json' }))
  } }],
  absWorkingDir: here,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  mainFields: ['module', 'main'],
  metafile: true,
  external: ['@agnes/plugin-runtime/channel-contract', '@agnes/protocol'],
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module';import {fileURLToPath as __fileURLToPath} from 'node:url';import {dirname as __pathDirname} from 'node:path';const require=__createRequire(import.meta.url);const __filename=__fileURLToPath(import.meta.url);const __dirname=__pathDirname(__filename);",
  },
})
const seen = new Set()
let notice =
  'AGH Feishu channel plugin. Apache-2.0.\nPlatform-only implementation using the public AGH channel contract.\n'
for (const input of Object.keys(result.metafile.inputs)) {
  let dir = dirname(resolve(here, input))
  while (dirname(dir) !== dir) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      if (typeof pkg.name !== 'string') { dir = dirname(dir); continue }
      if (!seen.has(pkg.name)) {
        seen.add(pkg.name)
        notice += `\n--- ${pkg.name}@${pkg.version} (${pkg.license ?? 'see license'}) ---\n`
        const license = (await readdir(dir)).find((name) => /^(license|copying)(\.|$)/i.test(name))
        if (license) notice += await readFile(join(dir, license), 'utf8')
      }
      break
    } catch {
      dir = dirname(dir)
    }
  }
}
notice += '\nFeishu brand icon: assets/feishu.png, user-provided source recorded in PROVENANCE.md. Brand rights belong to their respective owner.\n'
await writeFile(join(here, 'NOTICE'), notice)
await writeFile(
  join(here, 'dist/build-info.json'),
  JSON.stringify(
    {
      node: process.version,
      apiRange: '^5.13.0',
      bridge: 'host-owned',
      sdk: '@larksuiteoapi/node-sdk@1.76.0',
      bundled: [...seen].sort(),
    },
    null,
    2,
  ) + '\n',
)
console.log('Built standalone Feishu platform adapter; no runner, daemon or native runtime bundled')
