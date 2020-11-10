import { appRootPath } from '@nrwl/workspace/src/utils/app-root';
import {
  findProjectUsingImport,
  findSourceProject,
  getSourceFilePath,
} from '@nrwl/workspace/src/utils/runtime-lint-utils';
import { TSESTree } from '@typescript-eslint/experimental-utils';
import { createESLintRule } from '../utils/create-eslint-rule';
import { normalize } from '@angular-devkit/core';
import {
  createProjectGraph,
  ProjectGraph,
} from '@nrwl/workspace/src/core/project-graph';
import {
  readNxJson,
  readWorkspaceJson,
} from '@nrwl/workspace/src/core/file-utils';
import { TargetProjectLocator } from '@nrwl/workspace/src/core/target-project-locator';
import {
  directoryExists,
  fileExists,
  readJsonFile,
} from '@nrwl/workspace/src/utils/fileutils';

type Options = [
  {
    disableImportFromParentAndCurrentRoot: boolean;
  }
];

interface TsConfigJson {
  compileOnSave?: boolean;
  compilerOptions?: { [key: string]: string };
  exclude?: string[];
  include?: string[];
}

export type MessageIds = 'importUsingAlias' | 'importFromParentAndCurrentRoot';

export const RULE_NAME = 'no-barrel-files-import';

function checkIfImportIsFromCurrentProject(
  sourceProjectName: string,
  targetProjectName: string
): boolean {
  return sourceProjectName === targetProjectName;
}

function checkIfImportIsFromIndexFile(
  importPath: string,
  indexFileName: string = 'index'
): boolean {
  if (!importPath) {
    return;
  }
  const lastSlashIndex = importPath.lastIndexOf('/');

  return (
    lastSlashIndex > -1 &&
    importPath.substring(lastSlashIndex).includes(indexFileName)
  );
}

function checkIfImportIsFromFolderRoot(
  importPath: string,
  projectName?: string
): boolean {
  // it means import is from current folder
  if (importPath === '.') {
    return true;
  }
  const lastSlashIndex = importPath.lastIndexOf('/');

  // it means import is not from file directly, for example: '../', '../src/' or './test';
  const importIsFromFolderRoot = lastSlashIndex === importPath.length - 1;

  if (importIsFromFolderRoot) {
    return true;
  }

  const importFileName = importPath.substring(lastSlashIndex + 1);
  const projectGraph = getProjectGraph();
  const project = projectGraph ? projectGraph.nodes[projectName] : null;
  const importingFile = project
    ? project.data.files.find((file) => {
        const lastSlashIndexInFileName = file.file.lastIndexOf('/');
        const fileName = file.file.substring(lastSlashIndexInFileName);
        return importFileName === fileName;
      })
    : false;

  return !!importingFile;
}

function getProjectGraph(): ProjectGraph {
  if (!(global as any).projectGraph) {
    const workspaceJson = readWorkspaceJson();

    const nxJson = readNxJson();
    (global as any).npmScope = nxJson.npmScope;
    (global as any).projectGraph = createProjectGraph(workspaceJson, nxJson);
  }

  return (global as any).projectGraph;
}

function getProjectSourceRootFromWorkspaceJSON(projectName: string): string {
  const workspaceJson = readWorkspaceJson();
  const projects = workspaceJson ? workspaceJson.projects : null;
  const project = projects ? projects[projectName] : {};
  return project ? project.sourceRoot : null;
}

function getProjectAliasInTSConfigByRoot(
  tsConfig: TsConfigJson,
  root: string
): string {
  const paths = tsConfig ? tsConfig.compilerOptions.paths : null;
  return Object.keys(paths).find((key) => {
    const project = paths[key];
    const projectRoot = project ? project[0] : '';

    return projectRoot.includes(root);
  });
}

function checkIfImportFromIndexIsAllowed(
  params: {
    importPath?: string;
    projectSourceRoot?: string;
    sourceFilePath?: string;
    indexFileName?: string;
    targetProjectName?: string;
  } = {}
): boolean {
  const {
    importPath,
    projectSourceRoot,
    sourceFilePath,
    targetProjectName,
  } = params;
  const indexFileName = params.indexFileName || 'index';
  const importIsFromFolderRoot = checkIfImportIsFromFolderRoot(
    importPath,
    targetProjectName
  );

  if (importIsFromFolderRoot) {
    return false;
  }

  const importIsFromIndexFile = checkIfImportIsFromIndexFile(
    importPath,
    indexFileName
  );

  if (importIsFromIndexFile) {
    return false;
  }

  const filePathInsideProject = importPath.replace(
    sourceFilePath,
    projectSourceRoot
  );
  const importIsFromParentFolder = importPath.includes('../');
  const importIsFromCurrentFolder =
    filePathInsideProject === `./${indexFileName}`;

  return !importIsFromCurrentFolder && !importIsFromParentFolder;
}

function getIndexFileNameFromTSConfig(
  tsConfig: TsConfigJson,
  alias: string
): string {
  const paths = tsConfig ? tsConfig.compilerOptions.paths : null;

  const project = paths[alias];
  const projectRoot = project ? project[0] : '';
  const lastSlashIndex = projectRoot.lastIndexOf('/');
  const lastDotIndex = projectRoot.lastIndexOf('.');

  return projectRoot.substring(lastSlashIndex + 1, lastDotIndex);
}

function getProjectPath(): string {
  return normalize((global as any).projectPath || appRootPath);
}

function getTsConfig(): TsConfigJson {
  return readJsonFile<TsConfigJson>(`${appRootPath}/tsconfig.base.json`);
}

function checkIfImportIsEqualToAlias(
  importPath: string,
  alias: string
): boolean {
  return importPath === alias;
}

function getSourceProjectName(
  projectGraph: ProjectGraph,
  sourceFilePath: string
): string {
  const sourceProject = findSourceProject(projectGraph, sourceFilePath);
  return sourceProject ? sourceProject.name : null;
}

function getTargetProjectName(
  projectGraph: ProjectGraph,
  targetProjectLocator: TargetProjectLocator,
  sourceFilePath: string,
  importPath: string,
  npmScope: string
): string {
  const targetProject = findProjectUsingImport(
    projectGraph,
    targetProjectLocator,
    sourceFilePath,
    importPath,
    npmScope
  );
  return targetProject ? targetProject.name : null;
}

export default createESLintRule<Options, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'No barrel files imports allowed',
      category: 'Possible Errors',
      recommended: 'error',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          disableImportFromParentAndCurrentRoot: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      importUsingAlias: 'import using current project alias is not allowed',
      importFromParentAndCurrentRoot:
        'Import from barrel file located in current or parent directory is not allowed.',
    },
  },
  defaultOptions: [
    {
      disableImportFromParentAndCurrentRoot: false,
    },
  ],
  create(context, [{ disableImportFromParentAndCurrentRoot }]) {
    const projectGraph = getProjectGraph();
    const projectPath = getProjectPath();
    const tsConfig = getTsConfig();
    const sourceFilePath = getSourceFilePath(
      context.getFilename(),
      projectPath
    );
    const sourceProjectName = getSourceProjectName(
      projectGraph,
      sourceFilePath
    );
    const nxJson = readNxJson();
    (global as any).npmScope = nxJson.npmScope;
    const npmScope = (global as any).npmScope;

    if (!(global as any).targetProjectLocator) {
      (global as any).targetProjectLocator = new TargetProjectLocator(
        projectGraph.nodes
      );
    }
    const targetProjectLocator = (global as any)
      .targetProjectLocator as TargetProjectLocator;

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        const importPath = node.source.value.toString();

        const targetProjectName = getTargetProjectName(
          projectGraph,
          targetProjectLocator,
          sourceFilePath,
          importPath,
          npmScope
        );

        const isImportFromCurrentProject = checkIfImportIsFromCurrentProject(
          sourceProjectName,
          targetProjectName
        );

        if (!isImportFromCurrentProject) {
          return;
        }

        const projectSourceRoot = getProjectSourceRootFromWorkspaceJSON(
          targetProjectName
        );
        const alias = getProjectAliasInTSConfigByRoot(
          tsConfig,
          projectSourceRoot
        );
        const indexFileName = getIndexFileNameFromTSConfig(tsConfig, alias);

        /*
          It checks if current import uses alias of current project.
          This rule does not allow to import files by using current project's alias inside the project.
        */
        const importIsEqualToAlias = checkIfImportIsEqualToAlias(
          importPath,
          alias
        );

        if (importIsEqualToAlias) {
          context.report({
            node,
            messageId: 'importUsingAlias',
          });
          return;
        }

        /*
          This rule does not allow to import index.ts file form parrent root or from current root.
          You need to enable this condition in rule's options.
        */

        if (!disableImportFromParentAndCurrentRoot) {
          return;
        }

        const importFromIndexIsAllowed = checkIfImportFromIndexIsAllowed({
          importPath,
          projectSourceRoot,
          sourceFilePath,
          indexFileName,
          targetProjectName,
        });

        if (!importFromIndexIsAllowed) {
          context.report({
            node,
            messageId: 'importFromParentAndCurrentRoot',
          });
          return;
        }
      },
    };
  },
});
