// electron-builder leaves node_modules out of extra resources, but the bundled server needs its trimmed copy
const fs = require('node:fs');
const path = require('node:path');

exports.default = async ({ appOutDir, packager }) => {
  const res = packager.platform.name === 'mac'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  fs.cpSync('.next-desktop/standalone/node_modules', path.join(res, 'server', 'node_modules'), { recursive: true, verbatimSymlinks: true });
};
