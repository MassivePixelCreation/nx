import { appRootPath } from '@nrwl/workspace/src/utils/app-root';
import { findProjectUsingImport, findSourceProject, getSourceFilePath } from '@nrwl/workspace/src/utils/runtime-lint-utils';
import { TSESTree } from '@typescript-eslint/experimental-utils';
import { createESLintRule } from '../utils/create-eslint-rule';
import { normalize } from '@angular-devkit/core';
import { createProjectGraph, ProjectGraph } from '@nrwl/workspace/src/core/project-graph';
import { readNxJson, readWorkspaceJson } from '@nrwl/workspace/src/core/file-utils';
import { TargetProjectLocator } from '@nrwl/workspace/src/core/target-project-locator';
import { readJsonFile } from '@nrwl/workspace/src/utils/fileutils';

type Options = [
  {
    disableImportFromMainIndex: boolean;
    disableImportFromAnyIndex: boolean;
  }
];

export interface TsConfigJson {
  compileOnSave?: boolean;
  compilerOptions?: { [key: string]: string };
  exclude?: string[];
  include?: string[];
}

export type MessageIds = 'importUsingAlias' | 'importFromIndexFile' | 'importFromMainIndexFile';

export const RULE_NAME = 'no-barrel-files-import';

function checkIfImportIsFromCurrentProject(sourceProjectName: string, targetProjectName: string): boolean {
  return sourceProjectName === targetProjectName;
}

function checkIfImportIsFromMainIndexFile(params: {
  importPath?: string;
  projectSourceRoot?: string,
  sourceFilePath?: string,
  indexFileName?: string
} = {}): boolean {
  const { importPath, projectSourceRoot, sourceFilePath } = params;
  const indexFileName = params.indexFileName || 'index';
  const isImportFromIndexFile = checkIfImportIsFromIndexFile(importPath, indexFileName);

  if (!isImportFromIndexFile) {
    return;
  }

  const filePathInsideProject = importPath.replace(sourceFilePath, projectSourceRoot);
  const fileNestingCount = getStringOccuringCount(filePathInsideProject, '/');;
  const importNestingCount = getStringOccuringCount(importPath, '../');
  const currentImportIsInMainFolder = fileNestingCount === 1 && importNestingCount === 0;

  console.log('fileNestingCount: ' + fileNestingCount);
  console.log('importNestingCount: ' + importNestingCount);

  return currentImportIsInMainFolder || importNestingCount === fileNestingCount;
}

function getStringOccuringCount(text: string, textToCount: string): number {
  return text ? (text.match(RegExp(textToCount ,'g')) || []).length : 0;
}

function checkIfImportIsFromIndexFile(importPath: string, indexFileName: string = 'index'): boolean {
  if (!importPath) {
    return;
  }
  const lastSlashIndex = importPath.lastIndexOf('/');

  if (lastSlashIndex === -1) {
    return;
  }

  return importPath.substring(lastSlashIndex).includes(indexFileName);
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

function getProjectAliasInTSConfigByRoot(tsConfig: TsConfigJson, root: string): string {
  const paths = tsConfig ? tsConfig.compilerOptions.paths : null;
  return Object.keys(paths).find(key => {
    const project = paths[key];
    const projectRoot = project ? project[0] : '';

    return projectRoot.includes(root);
  });
}

function getIndexFileNameFromTSConfig(tsConfig: TsConfigJson, alias: string): string {
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
  return readJsonFile<TsConfigJson>(`${appRootPath}/tsconfig.json`);
}

function checkIfImportIsEqualToAlias(importPath: string, alias: string): boolean {
  return importPath === alias;
}

function getSourceProjectName(projectGraph: ProjectGraph, sourceFilePath: string): string {
  const sourceProject = findSourceProject(projectGraph, sourceFilePath);
  return sourceProject ? sourceProject.name : null;
}

function getTargetProjectName(
  projectGraph: ProjectGraph,
  targetProjectLocator: TargetProjectLocator,
  sourceFilePath: string,
  importPath: string,
  npmScope: string): string {
  const targetProject = findProjectUsingImport(projectGraph, targetProjectLocator, sourceFilePath, importPath, npmScope);
  return targetProject ? targetProject.name : null;
}

export default createESLintRule<Options, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'No barrel files imports allowed',
      category: 'Possible Errors',
      recommended: 'error'
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          disableImportFromMainIndex: { type: 'boolean' },
          disableImportFromAnyIndex: { type: 'boolean' }
        },
        additionalProperties: false,
      },
    ],
    messages: {
      importUsingAlias: 'import using current lib alias is not allowed',
      importFromIndexFile: 'Import directly from any index.ts file is not allowed.',
      importFromMainIndexFile: 'import directly from main index.ts file of current lib is not allowed.'
    },
  },
  defaultOptions: [
    {
      disableImportFromMainIndex: false,
      disableImportFromAnyIndex: false
    },
  ],
  create(context, [{ disableImportFromMainIndex, disableImportFromAnyIndex }]) {
    /**
     * Globally cached info about workspace
     */
    const projectGraph = getProjectGraph();
    const projectPath = getProjectPath();
    const tsConfig = getTsConfig();
    const sourceFilePath = getSourceFilePath(context.getFilename(), projectPath);
    const sourceProjectName = getSourceProjectName(projectGraph, sourceFilePath);

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

        const isImportFromCurrentProject = checkIfImportIsFromCurrentProject(sourceProjectName, targetProjectName);
  
        if (!isImportFromCurrentProject) {
          return;
        }
  
        const projectSourceRoot = getProjectSourceRootFromWorkspaceJSON(targetProjectName);
        const alias = getProjectAliasInTSConfigByRoot(tsConfig, projectSourceRoot);
        const indexFileName = getIndexFileNameFromTSConfig(tsConfig, alias);
  
        /*
          It checks if current import uses alias of current project.
          This rule does not allow to import files by using current project's alias inside the project.
        */
        const importIsEqualToAlias = checkIfImportIsEqualToAlias(importPath, alias);
  
          if (importIsEqualToAlias) {
            context.report({
              node,
              messageId: 'importUsingAlias',
            });
            return;
          }
  
        /*
          It checks if current import uses main index.ts file of current project.
          This rule does not allow to import files by using main index.ts file of this project inside the project.
          You need to enable this condition in rule's options.
        */

          console.log('disableImportFromMainIndex: ' + disableImportFromMainIndex);
          console.log('indexFileName: ' + indexFileName);
          console.log('sourceFilePath: ' + sourceFilePath);
          console.log('projectSourceRoot: ' + projectSourceRoot);
          console.log('importPath: ' + importPath);
          console.log('--------------------------------');

        const importIsFromMainIndexFile = disableImportFromMainIndex && checkIfImportIsFromMainIndexFile({
          importPath,
          projectSourceRoot,
          sourceFilePath,
          indexFileName
        });
  
        if (importIsFromMainIndexFile) {
          context.report({
            node,
            messageId: 'importFromMainIndexFile',
          });
          return;
        }
  
        /*
          It checks if current import uses any index.ts file of current project.
          This rule does not allow to import files by using any index.ts file of this project inside the project.
          You need to enable this condition in rule's options.
        */
        const importIsFromIndexFile = disableImportFromAnyIndex && checkIfImportIsFromIndexFile(importPath, indexFileName);
  
        if (importIsFromIndexFile) {
          context.report({
            node,
            messageId: 'importFromIndexFile',
          });
          return;
        }
      }
    };
  },
});
