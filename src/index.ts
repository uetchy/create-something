import chalk from 'chalk';
import { epicfail } from 'epicfail';
import execa, { CommonOptions, ExecaChildProcess } from 'execa';
import { existsSync, writeFileSync } from 'fs';
import {
  availableLicenses as getAvailableLicenses,
  makeLicenseSync,
} from 'license.js';
import path, { join, resolve } from 'path';
import yargsInteractive, { OptionData } from 'yargs-interactive';
import { exists, isOccupied } from './fs';
import { getGitUser, initGit } from './git';
import {
  addDeps,
  initPackage,
  installDeps,
  PackageManager,
  whichPm,
} from './npm';
import { copy, getAvailableTemplates } from './template';

export interface Option {
  [key: string]: OptionData | { default: boolean };
}

/** Options for `create` function */
export interface Options {
  /** Path to templates folder.
   *
   * In default, `templateRoot` is set to `path.resolve(__dirname, '../templates')`. You can change this to any location you like. */
  templateRoot: string;

  /** Modify package name.
   *
   * ```js
   * {
   *   modifyName: (name) => (name.startsWith('create-') ? name : `create-${name}`);
   * }
   * ```
   */
  modifyName?: (name: string) => string | Promise<string>;

  /** Additional questions can be defined.
   *
   *  These options will be available as CLI flags, interactive questions, and template strings. In the example above, `--language` flag and the `{{language}}` template string will be enabled in the app.
   */
  extra?: Option;

  /** Default value for a package description (default: `description`) */
  defaultDescription?: string;

  /** Default value for a package author (default: `user.name` in `~/.gitconfig` otherwise `Your name`) */
  defaultAuthor?: string;

  /** Default value for a package author email (default: `user.email` in `~/.gitconfig` otherwise `Your email`) */
  defaultEmail?: string;

  /** Default value for a template (default: `default`) */
  defaultTemplate?: string;

  /** Default value for license (default: `MIT`) */
  defaultLicense?: string;

  /** Default value for package manager (default: `undefined`)
   *
   * `npm`, `yarn`, `pnpm` and `bun` are available. `undefined` to auto detect package manager. */
  defaultPackageManager?: PackageManager;

  /** Interactively asks users for a description */
  promptForDescription?: boolean;

  /** Interactively asks users for a package author */
  promptForAuthor?: boolean;

  /** Interactively asks users for a package author email */
  promptForEmail?: boolean;

  /** Interactively asks users for a template
   *
   * If there are no multiple templates in the `templates` directory, it won't display a prompt anyways.
   *
   * Even if `promptForTemplate` is set to `false`, users can still specify a template via a command line flag `--template <template>`.
   * ```
   * create-something <name> --template <template>
   * ```
   */
  promptForTemplate?: boolean;

  /** Interactively asks users for a license */
  promptForLicense?: boolean;

  /** Interactively asks users for a package manager */
  promptForPackageManager?: boolean;

  /** Skip initializing a git repository at a creation time. */
  skipGitInit?: boolean;

  /** Skip installing package dependencies at a creation time. */
  skipNpmInstall?: boolean;

  /** Define after-hook script to be executed right after the initialization process. */
  after?: (options: AfterHookOptions) => void | Promise<void>;

  /** The caveat message will be shown after the entire process is completed.
   *
   * ```js
   * create('create-greet', {
   *   caveat: 'Happy coding!',
   * });
   * ```
   *
   * ```js
   * create('create-greet', {
   *   caveat: ({ answers }) => `Run -> cd ${answers.name} && make`,
   * });
   * ```
   */
  caveat?:
    | string
    | ((options: AfterHookOptions) => string | void | Promise<string | void>);
}

/** Records of user inputs */
export interface Answers {
  /** Selected template name
   *
   * e.g. `typescript`
   */
  template: string;

  /** Package name
   *
   * e.g. `create-greet`
   */
  name: string;

  /** Package description */
  description: string;

  /** Package author (e.g. "John Doe") */
  author: string;

  /** Package author email (e.g. "john@example.com") */
  email: string;

  /** Package author contact (e.g. "John Doe <john@example.com>") */
  contact: string;

  /** Package license (e.g. "MIT") */
  license: string;

  [key: string]: string | number | boolean | any[];
}

/** Options for after hook and caveat scripts */
export interface AfterHookOptions {
  /** Created package root
   *
   * e.g. `/path/to/ohayo`
   */
  packageDir: string;

  /** Template directory
   *
   * e.g. `/path/to/create-greet/templates/default`
   */
  templateDir: string;

  /** Current year */
  year: number;

  /** Node.js package manager to be used to initialize a package */
  packageManager: PackageManager;

  /** records of user inputs */
  answers: Answers;

  /** Package name
   *
   * e.g. `create-greet`
   *
   * @deprecated Use `answers.name` instead.
   */
  name: string;

  /** Selected template name
   *
   * e.g. `typescript`
   *
   * @deprecated Use `answers.template` instead
   */
  template: string;

  /** execute shell commands in the package dir */
  run: (
    command: string,
    options?: CommonOptions<string>
  ) => ExecaChildProcess<string>;

  /** install npm package. uses package manager specified by --node-pm CLI param (default: auto-detect) */
  installNpmPackage: (packageName: string, isDev?: boolean) => Promise<void>;
}

export class CLIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CLIError';
  }
}

export function printCommand(...commands: string[]) {
  console.log(chalk.gray('>', ...commands));
}

/** @see https://github.com/uetchy/create-create-app */
export async function create(appName: string, options: Options) {
  epicfail(require.main!.filename, {
    assertExpected: (err) => err.name === 'CLIError',
  });

  const gitUser = await getGitUser();

  const {
    templateRoot,
    modifyName,
    extra: extraOptions = {},
    after,
    caveat,

    defaultDescription = 'description',
    defaultAuthor = gitUser.name ?? 'Your name',
    defaultEmail = gitUser.email ?? 'Your email',
    defaultTemplate = 'default',
    defaultLicense = 'MIT',
    defaultPackageManager = undefined, // undefined by default, we'll try to guess pm manager later

    promptForDescription = true,
    promptForAuthor = true,
    promptForEmail = true,
    promptForTemplate = false,
    promptForLicense = true,
    promptForPackageManager = false,

    skipGitInit = false,
    skipNpmInstall = false,
  } = options;

  // verify args
  const firstArg = process.argv[2];
  if (firstArg === undefined) {
    throw new CLIError(`${appName} <name>`);
  }

  // configure package name and root direcotry
  const useCurrentDir = firstArg === '.';

  const name: string = useCurrentDir
    ? path.basename(process.cwd())
    : modifyName
    ? await Promise.resolve(modifyName(firstArg))
    : firstArg;

  const packageDir = useCurrentDir ? process.cwd() : resolve(name);
  if (isOccupied(packageDir)) {
    throw new CLIError(`${packageDir} is not empty directory.`);
  }

  // construct yargs options
  const availableTemplates = getAvailableTemplates(templateRoot);
  if (availableTemplates.length === 0) {
    throw new CLIError(`No template found`);
  }

  const availableLicenses = [...getAvailableLicenses(), 'UNLICENSED'];

  const isMultipleTemplates = availableTemplates.length > 1;

  const yargsOption = {
    interactive: { default: true },
    description: {
      type: 'input',
      describe: 'Description',
      default: defaultDescription,
      prompt: promptForDescription ? 'if-no-arg' : 'never',
    },
    author: {
      type: 'input',
      describe: 'Author name',
      default: defaultAuthor,
      prompt: promptForAuthor ? 'if-no-arg' : 'never',
    },
    email: {
      type: 'input',
      describe: 'Author email',
      default: defaultEmail,
      prompt: promptForEmail ? 'if-no-arg' : 'never',
    },
    template: {
      type: 'list',
      describe: 'Template',
      default: defaultTemplate,
      prompt: isMultipleTemplates && promptForTemplate ? 'if-no-arg' : 'never',
      choices: availableTemplates,
    },
    license: {
      type: 'list',
      describe: 'License',
      choices: availableLicenses,
      default: defaultLicense,
      prompt: promptForLicense ? 'if-no-arg' : 'never',
    },
    'node-pm': {
      type: 'list',
      describe: 'Package manager to use for installing packages from npm',
      choices: ['npm', 'yarn', 'pnpm', 'bun'],
      default: defaultPackageManager, // undefined by default, we'll try to guess pm later
      prompt: promptForPackageManager ? 'if-no-arg' : 'never',
    },
    'skip-git': {
      type: 'confirm',
      describe: 'Skip initializing git repository',
      prompt: 'never',
    },
    'skip-install': {
      type: 'confirm',
      describe: 'Skip installing package dependencies',
      prompt: 'never',
    },
    ...extraOptions,
  };

  const args = (await yargsInteractive()
    .usage('$0 <name> [args]')
    .interactive(yargsOption as any)) as Record<keyof typeof yargsOption, any>;

  const template = args['template'];
  const templateDir = resolve(templateRoot, template);

  if (!existsSync(templateDir)) {
    throw new CLIError('No template found');
  }

  // guess which package manager to use
  const packageManager = args['node-pm'] ?? whichPm();

  const ignoredProps = ['name', 'interactive', 'node-pm', 'nodePm'];
  const filteredArgs = Object.entries<string>(args)
    .filter((arg) => arg[0].match(/^[^$_]/) && !ignoredProps.includes(arg[0]))
    .reduce(
      (sum, cur) => ((sum[cur[0]] = cur[1]), sum),
      {} as {
        [key in keyof Answers]: Answers[key];
      }
    );

  const year = new Date().getFullYear();
  const contact = toContact(args['author'], args['email']);

  // construct answers
  const answers = {
    ...filteredArgs,
    name,
    contact,
  };

  // copy files from the template folder
  console.log(`\nCreating a new package in ${chalk.green(packageDir)}.`);

  await copy({
    sourceDir: templateDir,
    targetDir: packageDir,
    view: {
      ...answers,
      year,
      packageManager,
    },
  });

  // create license file
  try {
    const license = makeLicenseSync(args['license'], {
      year,
      project: name,
      description: args.description,
      organization: toContact(args['author'], args['email']),
    });
    const licenseText =
      (license.header ?? '') + license.text + (license.warranty ?? '');
    writeFileSync(resolve(packageDir, 'LICENSE'), licenseText);
  } catch (e) {
    // do not generate LICENSE
  }

  // init git if option skipGitInit or arg --skip-git are not set
  if (!(skipGitInit || args['skip-git'])) {
    try {
      console.log('\nInitializing a git repository');
      await initGit(packageDir);
    } catch (err: any) {
      if (err?.exitCode == 127) return; // no git available
      throw err;
    }
  }

  const installNpmPackage = async (
    pkg: string | string[],
    isDev: boolean = false
  ): Promise<void> => {
    if (!existsSync(join(packageDir, 'package.json'))) {
      await initPackage(packageDir, { pm: packageManager });
    }

    await addDeps(packageDir, Array.isArray(pkg) ? pkg : [pkg], {
      isDev,
      pm: packageManager,
    });
  };

  // run Node.js related tasks only if `package.json` does exist in the package root
  // and skipNpmInstall is not falsy
  const installDepsOnCreation =
    exists('package.json', packageDir) &&
    !(skipNpmInstall || args['skip-install']);

  if (installDepsOnCreation) {
    console.log(`\nInstalling dependencies using ${packageManager}`);
    await installDeps(packageDir, packageManager);
  }

  // setup afterHookOptions
  const run = (command: string, options: CommonOptions<string> = {}) => {
    const [script, ...scriptArgs] = command.split(' ');

    return execa(script, scriptArgs, {
      stdio: 'inherit',
      cwd: packageDir,
      ...options,
    });
  };

  const hookOptions: AfterHookOptions = {
    packageDir,
    templateDir,
    year,
    packageManager,
    answers,

    run,
    installNpmPackage,

    name,
    template,
  };

  // run after hook script
  if (after) {
    await Promise.resolve(after(hookOptions));
  }

  console.log(`\nSuccessfully created ${chalk.bold.cyan(packageDir)}`);

  // show caveat
  if (caveat) {
    switch (typeof caveat) {
      case 'string':
        console.log(caveat);
        break;
      case 'function':
        const response = await Promise.resolve(caveat(hookOptions));
        if (response) {
          console.log(response);
        }
        break;
      default:
    }
  }
}

function toContact(author: string, email?: string) {
  return `${author}${email ? ` <${email}>` : ''}`;
}
