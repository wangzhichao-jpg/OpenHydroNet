const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// Injectable filesystem permits real fault tests without changing production behavior.
function createAtomic(io = fs) {
  return async function atomic(file, content) {
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    await io.mkdir(path.dirname(file), { recursive: true });
    try {
      const handle = await io.open(tmp, 'wx');
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await io.rename(tmp, file);
    } finally {
      await io.rm(tmp, { force: true });
    }
  };
}
function parseUtf8Json(bytes) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw Error('文件不是有效的 UTF-8 JSON；不猜测编码或替换损坏字符，请保留原文件后修复。');
  }
}
module.exports = { createAtomic, atomic: createAtomic(), parseUtf8Json };
