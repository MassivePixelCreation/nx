import {
  DependencyType,
  ProjectGraph,
  ProjectType,
} from '@nrwl/workspace/src/core/project-graph';
import { TSESLint } from '@typescript-eslint/experimental-utils';
import * as parser from '@typescript-eslint/parser';
import { vol } from 'memfs';
import { extname, join } from 'path';

import { TargetProjectLocator } from '@nrwl/workspace/src/core/target-project-locator';
import { readFileSync } from 'fs';
import noBarrelFilesImport, {
  RULE_NAME as noBarrelFilesImportRuleName,
} from '../../src/rules/no-barrel-files-import';

jest.mock('fs', () => require('memfs').fs);
jest.mock('@nrwl/workspace/src/utils/app-root', () => ({
  appRootPath: '/root',
}));

const nxConfig = {
  npmScope: 'myapp',
  implicitDependencies: {},
  projects: {
    test: {
      tags: ['type:lib', 'scope:test', 'framework:angular'],
    },
  },
};

const workspaceConfig = {
  projects: {
    test: {
      root: 'libs/test',
      sourceRoot: 'libs/test/src',
      projectType: 'library',
      prefix: 'myapp',
    },
  },
};

const tsconfig = {
  compilerOptions: {
    baseUrl: '.',
    paths: {
      '@myapp/test': ['libs/test/src/index.ts'],
    },
    types: ['node'],
  },
  exclude: ['**/*.spec.ts'],
  include: ['**/*.ts'],
};

const fileSys = {
  './tsconfig.base.json': JSON.stringify(tsconfig),
  './workspace.json': JSON.stringify(workspaceConfig),
  './nx.json': JSON.stringify(nxConfig),
};

describe('No Barrel Files Import', () => {
  const defaultGraph = {
    nodes: {
      myappName: {
        name: 'myappName',
        type: ProjectType.app,
        data: {
          root: 'libs/myapp',
          tags: [],
          implicitDependencies: [],
          architect: {},
          files: [
            createFile(`apps/myapp/src/main.ts`),
            createFile(`apps/myapp/blah.ts`),
          ],
        },
      },
      test: {
        name: 'test',
        type: ProjectType.lib,
        data: {
          root: 'libs/test',
          tags: [],
          implicitDependencies: [],
          architect: {},
          files: [
            createFile(`libs/test/src/index.ts`),
            createFile(`libs/test/src/main.ts`),
            createFile(`libs/test/src/component/component.ts`),
          ],
        },
      },
    },
    dependencies: {},
  };

  beforeEach(() => {
    vol.fromJSON(fileSys, '/root');
  });

  it('should not error when import is from another lib', () => {
    const failures = runRule(
      {},
      `${process.cwd()}/proj/apps/myapp/src/main.ts`,
      `
        import '@mycompany/test';
        import '@mycompany/test/deep';
        import '../blah';
      `,
      defaultGraph
    );

    expect(failures.length).toEqual(0);
  });

  it('should error when file is imported from current project by using current project alias', () => {
    const failures = runRule(
      {},
      `${process.cwd()}/proj/libs/test/src/main.ts`,
      `
        import '@myapp/test';
      `,
      defaultGraph
    );

    expect(failures.length).toEqual(1);
    expect(failures[0].messageId).toBe('importUsingAlias');
  });

  describe('disable import from parent and current root option', () => {
    it('should not error when the option is disabled', () => {
      const failures = runRule(
        { disableImportFromParentAndCurrentRoot: false },
        `${process.cwd()}/proj/libs/test/src/index.ts`,
        `
          import './index';
          import '../index';
          import '../../index';
        `,
        defaultGraph
      );

      expect(failures.length).toEqual(0);
    });

    it('should error when the option is enabled and imports from from parrent folder root', () => {
      const expectedMessageId = 'importFromParentAndCurrentRoot';
      const failures = runRule(
        { disableImportFromParentAndCurrentRoot: true },
        `${process.cwd()}/proj/libs/test/src/main.ts`,
        `
          import '../test/';
          import '../test';
        `,
        defaultGraph
      );

      expect(failures.length).toEqual(2);
      expect(failures[0].messageId).toBe(expectedMessageId);
      expect(failures[1].messageId).toBe(expectedMessageId);
    });

    it('should error when the option is enabled and imports from index.ts file from parrent root', () => {
      const noNestingFailures = runRule(
        { disableImportFromParentAndCurrentRoot: true },
        `${process.cwd()}/proj/libs/test/src/main.ts`,
        `
          import './index';
        `,
        defaultGraph
      );

      expect(noNestingFailures.length).toEqual(1);
      expect(noNestingFailures[0].messageId).toBe(
        'importFromParentAndCurrentRoot'
      );

      const nestingFailures = runRule(
        { disableImportFromParentAndCurrentRoot: true },
        `${process.cwd()}/proj/libs/test/src/component/component.ts`,
        `
          import '../../index';
        `,
        defaultGraph
      );

      expect(nestingFailures.length).toEqual(1);
      expect(nestingFailures[0].messageId).toBe(
        'importFromParentAndCurrentRoot'
      );
    });

    it('should error when the option is enabled and imports index.ts file from current root', () => {
      const noNestingFailures = runRule(
        { disableImportFromParentAndCurrentRoot: true },
        `${process.cwd()}/proj/libs/test/src/main.ts`,
        `
          import './index';
          import '.';
        `,
        defaultGraph
      );

      expect(noNestingFailures.length).toEqual(2);
      expect(noNestingFailures[0].messageId).toBe(
        'importFromParentAndCurrentRoot'
      );
      expect(noNestingFailures[1].messageId).toBe(
        'importFromParentAndCurrentRoot'
      );

      const nestingFailures = runRule(
        { disableImportFromParentAndCurrentRoot: true },
        `${process.cwd()}/proj/libs/test/src/component/component.ts`,
        `
          import '../../index';
        `,
        defaultGraph
      );

      expect(nestingFailures.length).toEqual(1);
      expect(nestingFailures[0].messageId).toBe(
        'importFromParentAndCurrentRoot'
      );
    });
  });
});

const linter = new TSESLint.Linter();
const baseConfig = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018 as const,
    sourceType: 'module' as const,
  },
  rules: {
    [noBarrelFilesImportRuleName]: 'error',
  },
};
linter.defineParser('@typescript-eslint/parser', parser);
linter.defineRule(noBarrelFilesImportRuleName, noBarrelFilesImport);

function createFile(f) {
  return { file: f, ext: extname(f), hash: '' };
}

function runRule(
  ruleArguments: any,
  contentPath: string,
  content: string,
  projectGraph: ProjectGraph
): TSESLint.Linter.LintMessage[] {
  (global as any).projectPath = `${process.cwd()}/proj`;
  (global as any).npmScope = 'mycompany';
  (global as any).projectGraph = projectGraph;
  (global as any).targetProjectLocator = new TargetProjectLocator(
    projectGraph.nodes,
    (path) => readFileSync(join('/root', path)).toString()
  );

  const config = {
    ...baseConfig,
    rules: {
      [noBarrelFilesImportRuleName]: ['error', ruleArguments],
    },
  };

  return linter.verify(content, config as any, contentPath);
}
