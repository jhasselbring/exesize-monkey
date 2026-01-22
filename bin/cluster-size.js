#!/usr/bin/env node
import path from 'node:path';
import {
  analyzeTarget,
  recommendClusterSize,
  formatBytes,
  formatCount
} from '../lib/analyze.js';

function printHelp() {
  console.log(`Usage: npx npx-cluster-size-suggestion [path]

Suggest a cluster size based on file count and total size.
If no path is provided, the current directory is used.

Options:
  -h, --help   Show help
  --           End of options`);
}

function exitWithError(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let targetArg = null;
let afterDoubleDash = false;
const unknownOptions = [];

for (const arg of args) {
  if (afterDoubleDash) {
    if (targetArg === null) {
      targetArg = arg;
    }
    continue;
  }

  if (arg === '--') {
    afterDoubleDash = true;
    continue;
  }

  if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  }

  if (arg.startsWith('-')) {
    unknownOptions.push(arg);
    continue;
  }

  if (targetArg === null) {
    targetArg = arg;
  }
}

if (unknownOptions.length > 0) {
  exitWithError(`Unknown option(s): ${unknownOptions.join(', ')}`);
}

const targetPath = path.resolve(process.cwd(), targetArg || '.');

analyzeTarget(targetPath)
  .then((stats) => {
    const recommendation = recommendClusterSize(stats.totalBytes, stats.fileCount);
    const averageBytes = stats.fileCount > 0
      ? Math.round(stats.totalBytes / stats.fileCount)
      : 0;

    const lines = [
      `Target: ${stats.targetPath}`,
      `Files scanned: ${formatCount(stats.fileCount)} (dirs: ${formatCount(stats.dirCount)}, unreadable: ${formatCount(stats.unreadableEntries)}, skipped symlinks: ${formatCount(stats.skippedSymlinks)})`,
      `Total size: ${formatBytes(stats.totalBytes)}`,
      `Average file size: ${stats.fileCount > 0 ? formatBytes(averageBytes) : 'N/A'}`,
      `Largest file: ${stats.largestFilePath ? `${formatBytes(stats.largestFileBytes)} (${stats.largestFilePath})` : 'N/A'}`,
      '',
      `Suggested cluster size: ${recommendation.clusterSize}`,
      `Reason: size tier ${recommendation.sizeTier.label} (score ${recommendation.sizeTier.index}), file tier ${recommendation.fileTier.label} (score ${recommendation.fileTier.index}); ${recommendation.driver}.`
    ];

    console.log(lines.join('\n'));
  })
  .catch((error) => {
    exitWithError(error.message || String(error));
  });
