import { mkdir, symlink, readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url)),
  agh = resolve(process.env.AGH_SOURCE ?? join(here, '../agnes-harness'))
const paths = {}
for (const name of await readdir(join(agh, 'packages'))) {
  const root = join(agh, 'packages', name)
  let meta
  try {
    meta = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  for (const [key, spec] of Object.entries(
    typeof meta.exports === 'string' ? { '.': meta.exports } : (meta.exports ?? {}),
  )) {
    const entry = typeof spec === 'string' ? spec : spec.default
    if (entry?.endsWith('.ts'))
      paths[meta.name + (key === '.' ? '' : key.slice(1))] = [
        join(root, 'dist', entry.replace(/^\.\//, '').replace(/\.ts$/, '.d.ts')).replaceAll('\\', '/'),
      ]
  }
  if (!['extension-api', 'plugin-runtime', 'protocol', 'channels', 'sdk'].includes(name)) continue
  const target = join(here, 'node_modules', meta.name)
  await mkdir(dirname(target), { recursive: true })
  await symlink(root, target, 'junction').catch((e) => {
    if (e.code !== 'EEXIST') throw e
  })
}
await writeFile(
  join(here, 'tsconfig.local.json'),
  JSON.stringify({ extends: './tsconfig.json', compilerOptions: { paths } }, null, 2) + '\n',
)
console.log('Prepared public AGH contracts for local development; these links are not packaged')
