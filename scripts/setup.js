#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

console.log('🚀 [dsh-thought-flow] 正在自动配置并挂载到 DeepSeek Harness...');

const userHome = os.homedir();
const dshProfileDir = path.join(userHome, '.dsh', 'profiles', 'desktop');
const pkgJsonPath = path.join(dshProfileDir, 'package.json');
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

if (!fs.existsSync(pkgJsonPath)) {
  console.error(`❌ 未找到 DSH 桌面配置文件: ${pkgJsonPath}`);
  console.error('请确保已安装并至少启动过一次 DeepSeek Harness。');
  process.exit(1);
}

try {
  const pkgContent = fs.readFileSync(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(pkgContent);

  if (!pkg.dsh) pkg.dsh = {};
  if (!pkg.dsh.profile) pkg.dsh.profile = {};
  if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = [];

  // 1. 添加到 bundles
  if (!pkg.dsh.profile.bundles.includes('dsh-thought-flow')) {
    pkg.dsh.profile.bundles.push('dsh-thought-flow');
    console.log('✅ 已将 dsh-thought-flow 添加至 dsh.profile.bundles');
  }

  // 2. 添加到 dependencies (支持本地 link 或自动软链)
  if (!pkg.dependencies) pkg.dependencies = {};
  const linkTarget = `link:${repoRoot.replace(/\\/g, '/')}`;
  pkg.dependencies['dsh-thought-flow'] = linkTarget;
  console.log(`✅ 已关联依赖项: dsh-thought-flow -> ${linkTarget}`);

  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2), 'utf8');

  // 3. 确保 node_modules 中的软链接就位
  const targetNodeModules = path.join(dshProfileDir, 'node_modules', 'dsh-thought-flow');
  try {
    if (fs.existsSync(targetNodeModules)) {
      const stat = fs.lstatSync(targetNodeModules);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        fs.rmSync(targetNodeModules, { recursive: true, force: true });
      }
    }
    fs.symlinkSync(repoRoot, targetNodeModules, 'junction');
    console.log('✅ 已建立 node_modules 软链接');
  } catch (err) {
    console.log('ℹ️ node_modules 链接由 DSH pnpm 自动托管');
  }

  console.log('\n🎉 安装挂载完成！');
  console.log('👉 请完全退出并重新启动 DeepSeek Harness (或在窗口内按 Ctrl + R 刷新) 即可正常使用思考流卡片！');

} catch (err) {
  console.error('❌ 安装配置失败:', err);
  process.exit(1);
}
