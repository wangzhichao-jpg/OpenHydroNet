// Document lifecycle is independent of Electron rendering and numerical jobs.
const path = require('node:path');
function createDocumentController({ dialog, getWindow, atomic, flushRenderer }) {
  let state = { dirty: false, valid: true, project: null },
    quitting = null;
  const snapshotKey = (value) => JSON.stringify(value);
  function update(next) {
    if (
      typeof next?.dirty !== 'boolean' ||
      typeof next?.valid !== 'boolean' ||
      next.project?.format !== 'openhydronet'
    )
      throw Error('文档状态无效');
    state = structuredClone(next);
    if (!state.valid) state.dirty = true;
  }
  async function save(project) {
    if (project?.format !== 'openhydronet' || project.schema_version !== 1)
      throw Error('工程版本无效');
    const text = JSON.stringify(project, null, 2) + '\n';
    if (Buffer.byteLength(text, 'utf8') > 5_000_000)
      throw Error('工程超过桌面 5 MB 限制；请移除不需要的工况或拆分工程，不会写出无法重开的文件');
    const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
      title: '保存工程',
      defaultPath:
        String(project.name || '工程').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.ohn.json',
      filters: [{ name: 'OpenHydroNet 工程', extensions: ['json'] }],
    });
    if (canceled || !filePath) return false;
    await atomic(filePath, text);
    return true;
  }
  async function decision(reason) {
    const { response } = await dialog.showMessageBox(getWindow(), {
      type: 'question',
      title: '工程尚未保存',
      message: `当前工程有未保存修改。${reason || ''}`,
      detail: '可以先保存、明确放弃修改，或取消并返回工作台。自动恢复草稿不能代替正式保存。',
      buttons: ['保存后继续', '放弃修改', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return ['save', 'discard', 'cancel'][response] || 'cancel';
  }
  async function requestQuit(finish) {
    if (quitting) return quitting;
    quitting = (async () => {
      try {
        await flushRenderer();
        if (state.dirty) {
          const choice = await decision('是否退出？');
          if (choice === 'cancel') return false;
          if (choice === 'save') {
            if (!state.valid) {
              await dialog.showMessageBox(getWindow(), {
                type: 'warning',
                title: '无法保存',
                message: '存在未提交的无效参数，请先修正再保存。',
                buttons: ['返回修改'],
              });
              return false;
            }
            const snapshot = structuredClone(state.project),
              key = snapshotKey(snapshot);
            if (!(await save(snapshot))) return false;
            if (snapshotKey(state.project) !== key) {
              await dialog.showMessageBox(getWindow(), {
                type: 'warning',
                title: '工程已变化',
                message: '保存期间工程已变化，已保存先前快照；当前窗口保留，请核对最新输入。',
                buttons: ['返回工作台'],
              });
              return false;
            }
          }
        }
        await finish();
        return true;
      } finally {
        quitting = null;
      }
    })();
    return quitting;
  }
  return { update, save, decision, requestQuit, getState: () => structuredClone(state) };
}
module.exports = { createDocumentController };
