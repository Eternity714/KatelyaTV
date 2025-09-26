#!/usr/bin/env node

/**
 * 本地 D1 开发环境启动脚本
 * 
 * 使用方法：
 * 1. 确保已安装 wrangler: npm install -g wrangler
 * 2. 运行: node dev-d1.js
 * 
 * 这将启动一个支持 D1 数据库的本地开发环境
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 启动 D1 本地开发环境...');
console.log('📝 注意：这需要 wrangler CLI 工具');

// 检查是否安装了 wrangler
const checkWrangler = spawn('wrangler', ['--version'], { stdio: 'pipe' });

checkWrangler.on('error', (error) => {
  console.error('❌ 错误：未找到 wrangler CLI 工具');
  console.log('📦 请先安装 wrangler:');
  console.log('   npm install -g wrangler');
  console.log('   或者');
  console.log('   pnpm add -g wrangler');
  process.exit(1);
});

checkWrangler.on('close', (code) => {
  if (code === 0) {
    console.log('✅ wrangler CLI 已安装');
    
    // 启动 wrangler dev
    console.log('🔧 启动 wrangler dev...');
    const wranglerDev = spawn('wrangler', ['pages', 'dev', 'npm', 'run', 'dev', '--', '--compatibility-date=2024-09-01'], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    wranglerDev.on('error', (error) => {
      console.error('❌ 启动 wrangler dev 失败:', error.message);
      process.exit(1);
    });

    // 处理进程退出
    process.on('SIGINT', () => {
      console.log('\n🛑 正在停止开发服务器...');
      wranglerDev.kill('SIGINT');
      process.exit(0);
    });
  } else {
    console.error('❌ wrangler CLI 工具异常');
    process.exit(1);
  }
});