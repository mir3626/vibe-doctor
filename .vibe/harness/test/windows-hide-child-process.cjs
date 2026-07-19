'use strict';

const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { promisify } = require('node:util');

const WRAPPED = Symbol.for('vibe.selfTest.windowsHideWrapped');
const STATE = Symbol.for('vibe.selfTest.windowsHideState');

function withWindowsHide(options) {
  return {
    ...(options && typeof options === 'object' ? options : {}),
    windowsHide: true,
  };
}

function markWrapped(wrapper, original) {
  Object.defineProperty(wrapper, WRAPPED, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  Object.defineProperty(wrapper, 'name', {
    configurable: true,
    value: original.name,
  });
  return wrapper;
}

function promisifyChildCallback(wrapper) {
  return (...args) =>
    new Promise((resolve, reject) => {
      wrapper(...args, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
}

function wrapSpawn(original) {
  return markWrapped(function spawn(command, args, options) {
    if (Array.isArray(args)) {
      return original(command, args, withWindowsHide(options));
    }
    return original(command, withWindowsHide(args));
  }, original);
}

function wrapExec(original) {
  const wrapper = markWrapped(function exec(command, options, callback) {
    if (typeof options === 'function') {
      return original(command, withWindowsHide(), options);
    }
    return original(command, withWindowsHide(options), callback);
  }, original);
  Object.defineProperty(wrapper, promisify.custom, {
    configurable: true,
    value: promisifyChildCallback(wrapper),
  });
  return wrapper;
}

function wrapExecFile(original) {
  const wrapper = markWrapped(function execFile(file, args, options, callback) {
    if (Array.isArray(args)) {
      if (typeof options === 'function') {
        return original(file, args, withWindowsHide(), options);
      }
      return original(file, args, withWindowsHide(options), callback);
    }
    if (typeof args === 'function') {
      return original(file, withWindowsHide(), args);
    }
    return original(file, withWindowsHide(args), options);
  }, original);
  Object.defineProperty(wrapper, promisify.custom, {
    configurable: true,
    value: promisifyChildCallback(wrapper),
  });
  return wrapper;
}

function wrapExecFileSync(original) {
  return markWrapped(function execFileSync(file, args, options) {
    if (Array.isArray(args)) {
      return original(file, args, withWindowsHide(options));
    }
    return original(file, withWindowsHide(args));
  }, original);
}

function wrapExecSync(original) {
  return markWrapped(function execSync(command, options) {
    return original(command, withWindowsHide(options));
  }, original);
}

function wrapFork(original) {
  return markWrapped(function fork(modulePath, args, options) {
    if (Array.isArray(args)) {
      return original(modulePath, args, withWindowsHide(options));
    }
    return original(modulePath, withWindowsHide(args));
  }, original);
}

function ensureDescendantPreload() {
  const normalizedPath = __filename.replaceAll('\\', '/');
  const current = process.env.NODE_OPTIONS?.trim() ?? '';
  if (current.includes(normalizedPath)) {
    return current;
  }

  const requireOption = `--require="${normalizedPath}"`;
  process.env.NODE_OPTIONS = current ? `${current} ${requireOption}` : requireOption;
  return process.env.NODE_OPTIONS;
}

if (!globalThis[STATE]) {
  childProcess.spawn = wrapSpawn(childProcess.spawn);
  childProcess.spawnSync = wrapSpawn(childProcess.spawnSync);
  childProcess.exec = wrapExec(childProcess.exec);
  childProcess.execFile = wrapExecFile(childProcess.execFile);
  childProcess.execSync = wrapExecSync(childProcess.execSync);
  childProcess.execFileSync = wrapExecFileSync(childProcess.execFileSync);
  childProcess.fork = wrapFork(childProcess.fork);
  syncBuiltinESMExports();

  globalThis[STATE] = {
    preloadPath: __filename,
    wrappedMethods: [
      'spawn',
      'spawnSync',
      'exec',
      'execFile',
      'execSync',
      'execFileSync',
      'fork',
    ],
    withWindowsHide,
  };
}

ensureDescendantPreload();
process.env.VIBE_SELF_TEST_WINDOWS_HIDE_PRELOADED = '1';
module.exports = globalThis[STATE];
