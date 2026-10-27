/**
 * Stage documents: how they are rendered, where they live, and how they are
 * read back.
 *
 * A stage document is the contract the execution half is held to: the scope
 * list and the verification commands are copied out of it verbatim, so the
 * document and the gate can never disagree.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolveRemote, writeRemoteFile } from './remote.js';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
/**
 * Pick the stage the task is working on.
 * @param {TaskRecord} task - the task.
 * @returns {TaskStage | null} the current stage, or null when there is none.
 */
export function currentStage(task) {
    const index = task.stageIndex < 0 ? 0 : task.stageIndex;
    return task.stages[index] ?? null;
}
/** Prefix every stage document lives under, relative to the workspace. */
export const DOC_ROOT = 'docs/task-center';
/**
 * @param {string} taskId - owning task.
 * @param {number} ordinal - 1-based stage number.
 * @returns {string} workspace-relative POSIX path of the document.
 */
export function stageRelPath(taskId, ordinal) {
    return `${DOC_ROOT}/${taskId}/stage-${ordinal}.md`;
}
/**
 * Resolve a stored document path against the workspace root without escaping it.
 * @param {string} root - absolute workspace directory.
 * @param {string} docPath - workspace-relative path.
 * @returns {string} absolute path inside the workspace.
 */
export function stageAbsPath(root, docPath) {
    const base = resolve(root);
    const target = resolve(base, docPath);
    const rel = relative(base, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`文档路径越出工作区：${docPath}`);
    }
    return target;
}
/**
 * @param {StageDocInput} stage - structured stage.
 * @param {number} ordinal - 1-based number.
 * @param {string} taskTitle - task this stage belongs to.
 * @returns {string} the markdown document.
 */
export function renderStageDoc(stage, ordinal, taskTitle) {
    const scope = stage.scope.length === 0
        ? '_（未声明允许改动；执行阶段只能读取，任何写入都会被拒绝。）_'
        : stage.scope.map(entry => `- \`${entry}\``).join('\n');
    const steps = stage.steps.length === 0
        ? '_（未给出步骤。）_'
        : stage.steps.map((entry, index) => `${index + 1}. ${entry}`).join('\n');
    const verify = stage.verify.length === 0
        ? '_（未声明验收命令；阶段结束时将直接判定失败。）_'
        : stage.verify.map(entry => `- \`${entry}\``).join('\n');
    return [
        `# 阶段 ${ordinal}：${stage.title}`,
        '',
        `> 任务：${taskTitle}`,
        '> 本文档由规划阶段生成，经人工批准后才允许执行。执行期间，允许改动的范围以「允许改动」一节为准。',
        '',
        '## 目标',
        '',
        stage.goal.trim() === '' ? '_（未填写目标。）_' : stage.goal.trim(),
        '',
        '## 允许改动',
        '',
        scope,
        '',
        '## 步骤',
        '',
        steps,
        '',
        '## 验收',
        '',
        verify,
        '',
    ].join('\n');
}
/**
 * Write one document per stage under `<root>/docs/task-center/<taskId>/`.
 * @param {string} root - absolute workspace directory.
 * @param {string} taskId - owning task.
 * @param {StageDocInput[]} stages - stages in order.
 * @param {string} taskTitle - task title, quoted in every document.
 * @returns {Promise<string[]>} the workspace-relative paths written.
 */
export async function writeStageDocs(root, taskId, stages, taskTitle) {
    const written = [];
    const remote = resolveRemote(root);
    for (let position = 0; position < stages.length; position += 1) {
        const ordinal = position + 1;
        const relPath = stageRelPath(taskId, ordinal);
        const absPath = stageAbsPath(root, relPath);
        const text = renderStageDoc(stages[position], ordinal, taskTitle);
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, text, 'utf8');
        if (remote !== null) {
            await writeRemoteFile(remote, relPath, text);
        }
        written.push(relPath);
    }
    return written;
}
/**
 * @param {string} root - absolute workspace directory.
 * @param {string} docPath - workspace-relative document path.
 * @returns {Promise<string>} the document text.
 */
export async function readStageDoc(root, docPath) {
    return readFile(stageAbsPath(root, docPath), 'utf8');
}
/**
 * Where a stage's document sits on disk.
 * @param {string} root - absolute workspace directory.
 * @param {string} docPath - workspace-relative path.
 * @returns {string} absolute path.
 */
export function stageFile(root, docPath) {
    return join(resolve(root), docPath);
}
