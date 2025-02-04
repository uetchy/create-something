import { CLIError, printCommand } from '.';
import { spawnPromise } from './fs';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

// License for `whichPm`
// The MIT License (MIT)
// Copyright (c) 2017-2022 Zoltan Kochan <z@kochan.io>
// https://github.com/zkochan/packages/tree/main/which-pm-runs
export function whichPm(): PackageManager {
  if (!process.env.npm_config_user_agent) {
    return 'npm';
  }

  const pmSpec = process.env.npm_config_user_agent.split(' ')[0];
  const separatorPos = pmSpec.lastIndexOf('/');
  const name = pmSpec.substring(0, separatorPos);

  return name as PackageManager;
}

export async function initPackage(
  rootDir: string,
  {
    pm,
  }: {
    pm: PackageManager;
  }
) {
  const command: string = pm === 'yarn' ? 'yarnpkg' : pm;
  let args: string[];

  switch (pm) {
    case 'npm':
    case 'pnpm':
    case 'bun': {
      args = ['init', '-y'];
      process.chdir(rootDir);
      break;
    }
    case 'yarn': {
      args = ['init', '-y', '--cwd', rootDir];
      break;
    }
    default:
      throw new CLIError(`Unsupported package manager: ${pm}`);
  }

  printCommand(command, ...args);

  try {
    await spawnPromise(command, args, { stdio: 'inherit', shell: true });
  } catch (err) {
    throw new CLIError(`Failed to install dependencies: ${err}`);
  }
}

export async function installDeps(rootDir: string, pm: PackageManager) {
  const command: string = pm === 'yarn' ? 'yarnpkg' : pm;
  let args: string[];

  switch (pm) {
    case 'npm':
    case 'bun': {
      args = ['install'];
      process.chdir(rootDir);
      break;
    }
    case 'yarn': {
      args = ['install', '--cwd', rootDir];
      break;
    }
    case 'pnpm': {
      args = ['install', '--dir', rootDir];
      break;
    }
    default:
      throw new CLIError(`Unsupported package manager: ${pm}`);
  }

  printCommand(command, ...args);

  try {
    await spawnPromise(command, args, { stdio: 'inherit', shell: true });
  } catch (err) {
    throw new CLIError(`Failed to install dependencies: ${err}`);
  }
}

export async function addDeps(
  rootDir: string,
  deps: string[],
  {
    isDev = false,
    pm,
  }: {
    isDev?: boolean;
    pm: PackageManager;
  }
) {
  const command: string = pm === 'yarn' ? 'yarnpkg' : pm;
  let args: string[];

  switch (pm) {
    case 'npm': {
      args = ['install', isDev ? '-D' : '-S', ...deps];
      process.chdir(rootDir);
      break;
    }
    case 'yarn':
    case 'bun': {
      args = ['add', '--cwd', rootDir, ...deps, isDev ? '-D' : ''];
      break;
    }
    case 'pnpm': {
      args = ['add', '--dir', rootDir, ...deps, isDev ? '-D' : ''];
      break;
    }
    default:
      throw new CLIError(`Unsupported package manager: ${pm}`);
  }

  printCommand(command, ...args);

  try {
    await spawnPromise(command, args, { stdio: 'inherit', shell: true });
  } catch (err) {
    throw new CLIError(`Failed to add dependencies: ${err}`);
  }
}
