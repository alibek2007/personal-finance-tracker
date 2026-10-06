/**
 * Minimal driver for the embedded PostgreSQL binaries (package `embedded-postgres`).
 *
 * We spawn the binaries ourselves instead of using the package's launcher because on Windows
 * `initdb` re-executes itself via an ANSI-codepage path and fails when the install path contains
 * non-ASCII characters (e.g. a Cyrillic user profile). Using 8.3 short paths sidesteps that.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** 8.3 short path of an existing directory (Windows only); identity elsewhere. */
function shortPath(path: string): string {
  if (process.platform !== 'win32') return path;
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:PFM_SHORT_SRC).ShortPath',
    ],
    { encoding: 'utf8', env: { ...process.env, PFM_SHORT_SRC: path } },
  );
  return out.trim();
}

function binDir(): string {
  const pkgName =
    process.platform === 'win32'
      ? '@embedded-postgres/windows-x64'
      : `@embedded-postgres/${process.platform}-${process.arch}`;
  // Walk up to find node_modules (the package does not export package.json).
  let dir = import.meta.dirname;
  for (;;) {
    const candidate = join(dir, 'node_modules', pkgName, 'native', 'bin');
    if (existsSync(candidate)) return shortPath(candidate);
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(`Embedded PostgreSQL binaries (${pkgName}) not found. Run npm install.`);
    dir = parent;
  }
}

export interface EmbeddedPg {
  url(database: string): string;
  stop(): Promise<void>;
}

export interface StartOptions {
  dataDir: string;
  port: number;
  user?: string;
  password?: string;
  /** Delete the data directory first (used by tests). */
  fresh?: boolean;
}

export async function startEmbeddedPostgres(options: StartOptions): Promise<EmbeddedPg> {
  const { port, user = 'pfm', password = 'pfm_dev_password' } = options;
  const dataDir = resolve(options.dataDir);
  if (options.fresh) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const bins = binDir();
  const exe = (name: string) => join(bins, process.platform === 'win32' ? `${name}.exe` : name);
  const shortData = shortPath(dataDir);

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    const pwFile = join(tmpdir(), `pfm-pgpw-${process.pid}`);
    writeFileSync(pwFile, password);
    try {
      execFileSync(
        exe('initdb'),
        [
          `--pgdata=${shortData}`,
          `--username=${user}`,
          `--pwfile=${pwFile}`,
          '--auth=password',
          '--encoding=UTF8',
          '--locale=C',
        ],
        { stdio: 'pipe' },
      );
    } finally {
      rmSync(pwFile, { force: true });
    }
  }

  const child: ChildProcess = spawn(
    exe('postgres'),
    ['-D', shortData, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  await new Promise<void>((resolveReady, reject) => {
    let log = '';
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes('ready to accept connections')) resolveReady();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => reject(new Error(`postgres exited with code ${code}\n${log}`)));
    setTimeout(
      () => reject(new Error(`postgres did not start within 30s\n${log}`)),
      30_000,
    ).unref();
  });

  return {
    url: (database) => `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`,
    async stop() {
      if (child.exitCode !== null) return;
      try {
        execFileSync(exe('pg_ctl'), ['stop', '-D', shortData, '-m', 'fast', '-w'], {
          stdio: 'pipe',
        });
      } catch {
        child.kill();
      }
    },
  };
}
